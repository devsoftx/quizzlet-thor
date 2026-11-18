#!/usr/bin/env python3
"""Exercise the production Redis Lua scripts in a disposable, isolated Redis.

By default this starts a Redis container with no network (needs Docker). With
QUIZZLET_REDIS_LOCAL=1 it starts a throwaway local `redis-server` on a private
Unix socket instead (nothing is saved to disk). It never touches a Redis that
was already running.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid

root = Path(__file__).resolve().parents[1]
source = (root / 'server/store.ts').read_text()


def lua(name):
    match = re.search(r'export const ' + name + r' = `([\s\S]*?)`;', source)
    if not match:
        raise SystemExit(f'{name} not found in server/store.ts')
    return match.group(1)


SCORE, CLAIM, PRUNE, ORPHAN_NAMES = (lua(n) for n in ('SCORE_SCRIPT', 'CLAIM_SCRIPT', 'PRUNE_SCRIPT', 'ORPHAN_NAMES_SCRIPT'))

# The same numbers server/store.ts and src/points.ts pass in.
POINTS, BONUS, THRESHOLD = 10, 5, 3
BURST, MS_PER_ANSWER, SESSION_MS = 20, 2000, 3600000

local = os.environ.get('QUIZZLET_REDIS_LOCAL') == '1'
name = f'quizzlet-score-test-{uuid.uuid4().hex[:12]}'
workdir = tempfile.mkdtemp(prefix='quizzlet-redis-') if local else None
socket_path = os.path.join(workdir, 'redis.sock') if local else None
server = None


def redis(*args):
    args = [str(a) for a in args]
    if local:
        command = ['redis-cli', '-s', socket_path, '--raw', *args]
    else:
        command = ['docker', 'exec', name, 'redis-cli', '--raw', *args]
    return subprocess.check_output(command, text=True).strip().splitlines()


started = False
try:
    if local:
        server = subprocess.Popen(
            ['redis-server', '--port', '0', '--unixsocket', socket_path, '--save', '', '--appendonly', 'no', '--dir', workdir],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            if os.path.exists(socket_path):
                break
            time.sleep(0.1)
        else:
            raise SystemExit('local redis-server did not start')
    else:
        subprocess.check_output(['docker', 'run', '-d', '--rm', '--network', 'none', '--name', name, 'redis:7.4.2-alpine'], text=True)
        time.sleep(0.5)
    started = True

    now = int(time.time() * 1000)
    expires = now + SESSION_MS  # a session that started just now

    def new_session(key='session:test', expires_at=None):
        redis('DEL', key)
        redis('HSET', key, 'points', '0', 'streak', '0', 'answered', '0', 'expiresAt', str(expires_at or expires))

    def score(batch, answers='1', fingerprint='same', player='guest', profile='0', streak_before='', at=None, session='session:test'):
        return redis('EVAL', SCORE, '2', session, f'receipt:{batch}',
                     fingerprint, answers, player, str(at or now), 'Explorer', profile, str(expires + 300000), str(streak_before),
                     POINTS, BONUS, THRESHOLD, BURST, MS_PER_ANSWER, SESSION_MS)

    # --- A batch replayed in parallel is counted once; a different payload under the same id conflicts.
    new_session()
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda _: score('one'), range(8)))
    assert sorted(results) == [['ok', '10', '10', '10', '0']] + [['ok', '10', '10', '10', '1']] * 7, results
    assert score('one', fingerprint='different') == ['conflict']
    assert redis('HGET', 'session:test', 'points') == ['10']
    assert redis('ZSCORE', 'leaderboard', 'guest') == ['10']
    assert redis('HGET', 'player-names', 'guest') == ['Explorer']

    # --- A key of the wrong type stops the script before anything is written.
    redis('SET', 'player-names', 'invalid-type')
    assert score('two') == ['error']
    assert redis('HGET', 'session:test', 'points') == ['10']
    redis('FLUSHALL')

    # --- The streak lives in the session: a forged streakBefore earns no bonus.
    new_session()
    assert score('forged', answers='1', streak_before=200) == ['ok', '10', '10', '10', '0']
    assert score('second', answers='1') == ['ok', '10', '20', '20', '0']          # really on 1, now 2
    assert score('third', answers='1', streak_before=2) == ['ok', '15', '35', '35', '0']   # third in a row: bonus
    assert score('new-round', answers='1', streak_before=0) == ['ok', '10', '45', '45', '0']  # a new round starts over
    assert score('raise', answers='1', streak_before=50) == ['ok', '10', '55', '55', '0']    # the stored streak (1) wins
    assert score('mixed', answers='1011', streak_before=2) == ['ok', '35', '90', '90', '0']  # 15 + 0 + 10 + 10
    assert redis('HGET', 'session:test', 'streak') == ['2']
    assert redis('HGET', 'session:test', 'answered') == ['9']
    # A replay returns what was earned at the time, whatever the streak is now.
    assert score('third', answers='1', streak_before=2) == ['ok', '15', '35', '35', '1']
    # Asking for the totals (no answers) changes neither the streak nor the count.
    assert score('totals', answers='', streak_before=0) == ['ok', '0', '90', '90', '0']
    assert redis('HGET', 'session:test', 'streak') == ['2']
    assert redis('HGET', 'session:test', 'answered') == ['9']
    redis('FLUSHALL')

    # --- Pace limit: a burst of 20, then one answer every 2 seconds since the session started.
    new_session()
    assert score('burst', answers='0' * BURST)[0] == 'ok'
    assert score('too-fast', answers='1') == ['limited']
    assert redis('HGET', 'session:test', 'points') == ['0']
    assert redis('EXISTS', 'receipt:too-fast') == ['0']           # nothing kept: the same batch can be sent later
    assert score('too-fast', answers='1', at=now + MS_PER_ANSWER) == ['ok', '10', '10', '10', '0']
    assert score('again', answers='1', at=now + MS_PER_ANSWER) == ['limited']
    assert score('forged-run', answers='1' * 200, streak_before=200, at=now + MS_PER_ANSWER) == ['limited']
    assert score('totals', answers='', at=now + MS_PER_ANSWER)[0] == 'ok'   # totals are always answered
    # Parallel batches can't get past the limit together.
    new_session()
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda i: score(f'race-{i}', answers='1' * 10)[0], range(8)))
    assert sorted(results) == ['limited'] * 6 + ['ok'] * 2, results
    assert redis('HGET', 'session:test', 'answered') == [str(BURST)]
    redis('FLUSHALL')

    # --- A private kid profile: points count, the public board doesn't change.
    new_session()
    redis('SADD', 'leaderboard-hidden', 'p:profile')
    assert score('private', player='p:profile', profile='1') == ['ok', '10', '10', '10', '0']
    assert redis('ZSCORE', 'leaderboard', 'p:profile') == []
    assert redis('HGET', 'player-totals', 'p:profile') == ['10']
    assert score('private', player='p:profile', profile='1') == ['ok', '10', '10', '10', '1']
    # A listed profile with no points yet isn't put on the board with a zero.
    assert score('listed-zero', answers='0', player='p:listed', profile='1') == ['ok', '0', '10', '0', '0']
    assert redis('ZSCORE', 'leaderboard', 'p:listed') == []
    assert score('listed', answers='1', player='p:listed', profile='1') == ['ok', '10', '20', '10', '0']
    assert redis('ZSCORE', 'leaderboard', 'p:listed') == ['10']

    # --- A removed player (deleted profile, or an operator's removal) keeps its hidden marker:
    #     a late score never puts it back on the leaderboard. This mirrors RedisStore.removePlayer.
    def remove_player(key):
        redis('SADD', 'leaderboard-hidden', key)
        redis('ZREM', 'leaderboard', key)
        redis('HDEL', 'player-names', key)
        redis('HDEL', 'player-emojis', key)
        redis('HDEL', 'player-totals', key)
        redis('DEL', f'guest-owner:{key}')
    remove_player('p:listed')
    assert score('late', answers='1', player='p:listed', profile='1')[0] == 'ok'
    assert redis('ZSCORE', 'leaderboard', 'p:listed') == []
    assert redis('ZRANGE', 'leaderboard', '0', '-1') == []
    new_session('session:guest')
    assert score('g1', answers='1', player='rude name', session='session:guest') == ['ok', '10', '10', '10', '0']
    remove_player('rude name')
    assert score('g2', answers='1', player='rude name', session='session:guest') == ['ok', '10', '20', '20', '0']  # session points only
    assert redis('ZSCORE', 'leaderboard', 'rude name') == []
    assert redis('HGET', 'player-names', 'rude name') == []

    # --- A guest who earns nothing leaves no leaderboard entry and no stored name.
    new_session('session:zero')
    assert score('z1', answers='00', player='quiet guest', session='session:zero') == ['ok', '0', '0', '0', '0']
    assert redis('ZSCORE', 'leaderboard', 'quiet guest') == []
    assert redis('HEXISTS', 'player-names', 'quiet guest') == ['0']

    # --- An ended session saves nothing.
    redis('HSET', 'session:test', 'expiresAt', str(now - 1))
    assert score('expired', player='p:profile', profile='1') == ['expired']
    assert redis('HGET', 'player-totals', 'p:profile') == ['10']
    redis('FLUSHALL')

    # --- Guest nicknames: the first browser holds the name; another one is refused.
    def claim(player, owner, ttl=60000):
        return redis('EVAL', CLAIM, '1', f'guest-owner:{player}', owner, ttl)
    assert claim('ana', 'browser-a') == ['1']
    assert claim('ana', 'browser-b') == ['0']
    assert claim('ana', 'browser-a') == ['1']
    assert int(redis('PTTL', 'guest-owner:ana')[0]) > 0
    assert claim('ben', 'browser-b', ttl=1) == ['1']
    time.sleep(0.05)
    assert claim('ben', 'browser-a') == ['1']   # the claim ran out
    redis('FLUSHALL')

    # --- Pruning: keep the top 1,000 guests, remove the rest, never touch kid profiles.
    def prune(keep, budget):
        return redis('EVAL', PRUNE, '0', keep, budget)
    pipe = []
    for i in range(2000):
        pipe += [f'ZADD leaderboard {3000 - i} "guest {i}"', f'HSET player-names "guest {i}" "Guest {i}"']
    pipe += ['ZADD leaderboard 5000 p:top', 'ZADD leaderboard 2500 p:middle', 'ZADD leaderboard 1 p:bottom',
             'HSET player-names p:top "Top Kid" p:middle "Middle Kid" p:bottom "Bottom Kid"',
             'HSET player-names "never scored" "Never Scored"']
    cli = ['redis-cli', '-s', socket_path] if local else ['docker', 'exec', '-i', name, 'redis-cli']
    subprocess.run(cli, input='\n'.join(pipe) + '\n', text=True, stdout=subprocess.DEVNULL, check=True)
    assert redis('ZCARD', 'leaderboard') == ['2003']
    assert prune(1000, 300) == ['300', '0']      # a bounded step: more to do
    removed = 300
    for _ in range(20):
        count, done = prune(1000, 300)
        removed += int(count)
        if done == '1':
            break
    assert removed == 1000, removed
    assert redis('ZCARD', 'leaderboard') == ['1003']
    assert redis('ZSCORE', 'leaderboard', 'guest 999') == ['2001']    # the 1,000th guest stays
    assert redis('ZSCORE', 'leaderboard', 'guest 1000') == []         # the 1,001st is gone
    assert redis('HEXISTS', 'player-names', 'guest 1000') == ['0']
    for kid in ('p:top', 'p:middle', 'p:bottom'):
        assert redis('ZSCORE', 'leaderboard', kid) != [], kid
        assert redis('HEXISTS', 'player-names', kid) == ['1'], kid
    assert prune(1000, 300) == ['0', '1']        # nothing left to remove
    assert prune(5000, 300) == ['0', '1']        # fewer guests than the limit: nothing to do
    # Names without a score (older sessions that never earned points) are dropped; everything else stays.
    cursor, dropped = '0', 0
    while True:
        cursor, count = redis('EVAL', ORPHAN_NAMES, '0', cursor)
        dropped += int(count)
        if cursor == '0':
            break
    assert dropped == 1, dropped
    assert redis('HEXISTS', 'player-names', 'never scored') == ['0']
    assert redis('HLEN', 'player-names') == ['1003']

    print('PASS: replay and conflict, type failure, server-side streak, pace limit, private and removed players, '
          'expired sessions, guest nickname claims, and guest pruning')
finally:
    if local:
        if server:
            server.terminate()
            server.wait(timeout=5)
        shutil.rmtree(workdir, ignore_errors=True)
    elif started:
        subprocess.run(['docker', 'stop', name], stdout=subprocess.DEVNULL, check=False)
