#!/usr/bin/env python3
"""Exercise the production score Lua script in a disposable, isolated Redis container."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import re
import subprocess
import time
import uuid

root = Path(__file__).resolve().parents[1]
source = (root / 'server/store.ts').read_text()
match = re.search(r'const script = `([\s\S]*?)`;', source)
if not match:
    raise SystemExit('Score script not found')
script = match.group(1)
name = f'quizzlet-score-test-{uuid.uuid4().hex[:12]}'

def docker(*args):
    return subprocess.check_output(['docker', *map(str, args)], text=True).strip()

def redis(*args):
    return docker('exec', name, 'redis-cli', '--raw', *args).splitlines()

started = False
try:
    docker('run', '-d', '--rm', '--network', 'none', '--name', name, 'redis:7.4.2-alpine')
    started = True
    now = int(time.time() * 1000)
    expires = now + 3600000
    redis('HSET', 'session:test', 'points', '0', 'expiresAt', str(expires))
    def score(batch, fingerprint='same', player='guest', profile='0'):
        return redis('EVAL', script, '2', 'session:test', f'receipt:{batch}', fingerprint, '10', player, str(now), 'Explorer', profile, str(expires + 300000))
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda _: score('one'), range(8)))
    assert all(r == ['ok', '10', '10'] for r in results), results
    assert score('one', 'different') == ['conflict']
    assert redis('HGET', 'session:test', 'points') == ['10']
    assert redis('ZSCORE', 'leaderboard', 'guest') == ['10']
    redis('SET', 'player-names', 'invalid-type')
    assert score('two') == ['error']
    assert redis('HGET', 'session:test', 'points') == ['10']
    redis('FLUSHALL')
    redis('HSET', 'session:test', 'points', '0', 'expiresAt', str(expires))
    redis('SADD', 'leaderboard-hidden', 'p:profile')
    assert score('private', player='p:profile', profile='1') == ['ok', '10', '10']
    assert redis('ZSCORE', 'leaderboard', 'p:profile') == []
    assert redis('HGET', 'player-totals', 'p:profile') == ['10']
    assert score('private', player='p:profile', profile='1') == ['ok', '10', '10']
    redis('HSET', 'session:test', 'expiresAt', str(now - 1))
    assert score('expired', player='p:profile', profile='1') == ['expired']
    assert redis('HGET', 'player-totals', 'p:profile') == ['10']
    print('PASS: Redis concurrent replay, conflict, type failure, private scoring, and expired-session rejection')
finally:
    if started:
        subprocess.run(['docker', 'stop', name], stdout=subprocess.DEVNULL, check=False)
