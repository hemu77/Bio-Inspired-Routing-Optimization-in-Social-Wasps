"""Independently reconstruct seeded inputs; no simulations or private data."""
import gzip
import json
from pathlib import Path

import numpy as np
from continuous_model import ENVIRONMENTS, SUPPLIES, VERSION, synthetic_colony
from research_model import HUNGER_GROWTH, STRATEGIES


def export_inputs():
    root = Path(__file__).parent / 'web/public/continuous'
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    if manifest['model_version'] != VERSION:
        raise ValueError('Regenerate the continuous campaign first')
    expected = {f'{env}-{supply}' for env in ENVIRONMENTS for supply in SUPPLIES}
    if set(manifest['replays']) != expected or any(set(methods) != set(STRATEGIES) for methods in manifest['replays'].values()):
        raise ValueError('Expected all nine scenarios and six policies')
    inputs = {}
    for environment, (count, workers, _) in ENVIRONMENTS.items():
        stages = synthetic_colony(42, environment)[2]
        growth = np.array([HUNGER_GROWTH[s] for s in stages]) * np.random.default_rng(
            np.random.SeedSequence([42, 9833])).uniform(.75, 1.25, count)
        requests = [np.random.default_rng(np.random.SeedSequence([42, 9834, w])).uniform(.5, 1., 500)*2
                    for w in range(workers)]
        lengths = [0]*workers
        for scenario, methods in manifest['replays'].items():
            if not scenario.startswith(environment+'-'):
                continue
            for strategy, name in methods.items():
                path = (root / name).resolve()
                if path.parent != root.resolve():
                    raise ValueError('Invalid replay path')
                data = path.read_bytes()
                trace = json.loads(gzip.decompress(data) if name.endswith('.gz') else data)
                if (trace['scenario'], trace['strategy'], trace['environment'], trace['seed']) != (scenario, strategy, environment, 42):
                    raise ValueError('Replay identity mismatch')
                if trace['model_version'] != VERSION or trace['source_checksum'] != manifest['source_checksum']:
                    raise ValueError('Mixed campaign versions')
                np.testing.assert_array_equal(trace['individual_growth'], growth)
                used = [0]*workers
                for frame in trace['frames']:
                    for event in frame['events']:
                        if event['type'] == 'refill' and event['amount'] > 0:
                            w = event['worker']
                            if event['requested'] != requests[w][used[w]]:
                                raise ValueError('Refill does not match seeded worker stream')
                            used[w] += 1
                lengths = [max(a,b) for a,b in zip(lengths,used)]
        inputs[environment] = {'individual_growth': growth.tolist(),
                               'refill_requests': [r[:n].tolist() for r,n in zip(requests,lengths)]}
    manifest['stochastic_inputs'] = inputs
    pending = root / 'manifest.json.tmp'
    pending.write_text(json.dumps(manifest, indent=2, allow_nan=False), encoding='utf-8')
    pending.replace(root / 'manifest.json')
    print('Verified seed-42 growth and pickup streams for all 54 replays')


if __name__ == '__main__':
    export_inputs()
