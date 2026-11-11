"""Turn a project the Bambu Studio app saved into a settings template for that printer (see docs/adr/0003).

The saved project must have Bambu PLA Basic and a Bambu TPU 95A filament loaded. The template has three
filament slots: PLA (Body colour), PLA (Accent colour), TPU (tyres). Colours are filled in at export.

Usage: python -I capture.py <saved project.3mf> [more.3mf ...]
Writes src/data/bambu/<printer id>.json and updates src/data/bambu/index.json.
"""
import json
import re
import sys
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / 'src' / 'data' / 'bambu'
PROFILES = Path(r'C:/Program Files/Bambu Studio/resources/profiles/BBL/filament')
# Per-filament lists Bambu Studio adds that are not in the filament profile files.
EXTRA_PER_FILAMENT = {
    'default_filament_colour', 'close_optional_fan_first_x_layers', 'enable_overhang_bridge_fan',
    'enable_pressure_advance', 'first_x_layer_fan_speed', 'first_x_layer_optional_fan_speed',
    'first_x_layer_part_fan_speed', 'ironing_fan_speed', 'min_temperature_when_ec', 'optional_cooling_fan_speed',
    'optional_fan_full_speed_layer', 'overhang_threshold_participating_cooling', 'pressure_advance',
}
SAME_FILAMENT_PURGE_MM3 = '280'  # PLA to PLA in a different colour still needs a purge


def printer_id(settings_id: str) -> str:
    """'Bambu Lab X1 Carbon 0.4 nozzle' -> 'x1-carbon' (matches src/data/printers.json)."""
    name = re.sub(r'^Bambu Lab ', '', settings_id)
    name = re.sub(r' 0\.4 nozzle$', '', name)
    return re.sub(r'\s+', '-', name.lower())


def filament_profile_keys(names: list[str]) -> set[str]:
    """Every setting defined anywhere in these filaments' profile chains (installed with Bambu Studio)."""
    keys: set[str] = set()
    for name in names:
        while name:
            data = json.loads((PROFILES / f'{name}.json').read_text(encoding='utf-8'))
            keys |= set(data)
            name = data.get('inherits')
    return keys


def is_per_filament(key: str, filament_keys: set[str]) -> bool:
    """Decided by where the setting comes from, never by list length: printer lists (bed corners, one entry
    per nozzle) can happen to have as many entries as there are filaments."""
    return key in filament_keys or key.startswith('filament_') or key in EXTRA_PER_FILAMENT


def reslot(saved: dict, picks: list[int]) -> dict:
    """Rebuild every per-filament list so the slots are the saved filaments at the given indexes.

    Per-filament lists hold either one entry per filament, or one entry per filament per nozzle variant.
    Filaments can have different numbers of variants (on dual-nozzle printers TPU adds "TPU High Flow"),
    so the variant entries are grouped by `filament_self_index`, which names the filament of each entry.
    """
    n = len(saved['filament_settings_id'])
    owner = saved['filament_self_index']
    entries = [[j for j, f in enumerate(owner) if f == str(i + 1)] for i in range(n)]
    filament_keys = filament_profile_keys(saved['filament_settings_id'])
    out = dict(saved)
    for key, value in saved.items():
        if not isinstance(value, list) or not is_per_filament(key, filament_keys):
            continue
        if key == 'filament_self_index':
            out[key] = [str(slot + 1) for slot, p in enumerate(picks) for _ in entries[p]]
        elif len(value) == len(owner) and len(owner) != n:
            out[key] = [value[j] for p in picks for j in entries[p]]
        elif len(value) == n:
            out[key] = [value[p] for p in picks]
    # Purge volume between every pair of slots, one table per nozzle (dual-nozzle printers have two).
    m, k = saved['flush_volumes_matrix'], len(picks)
    nozzles = len(m) // (n * n)
    out['flush_volumes_matrix'] = [
        '0' if i == j else (m[z * n * n + picks[i] * n + picks[j]] if picks[i] != picks[j] else SAME_FILAMENT_PURGE_MM3)
        for z in range(nozzles) for i in range(k) for j in range(k)
    ]
    vector = saved['flush_volumes_vector']
    out['flush_volumes_vector'] = [x for p in picks for x in vector[2 * p:2 * p + 2]]
    return out


def capture(path: Path) -> tuple[str, dict]:
    saved = json.loads(zipfile.ZipFile(path).read('Metadata/project_settings.config'))
    types = saved['filament_type']
    if 'PLA' not in types or 'TPU' not in types:
        raise SystemExit(f'{path.name}: needs Bambu PLA Basic and a Bambu TPU 95A loaded; has {saved["filament_settings_id"]}')
    pla, tpu = types.index('PLA'), types.index('TPU')
    template = reslot(saved, [pla, pla, tpu])
    return printer_id(saved['printer_settings_id']), template


def main(paths: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    index_path = OUT / 'index.json'
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    for p in map(Path, paths):
        pid, template = capture(p)
        (OUT / f'{pid}.json').write_text(json.dumps(template, separators=(',', ':')) + '\n', encoding='utf-8')
        index[pid] = {
            'printer': template['printer_settings_id'],
            'process': template['print_settings_id'],
            'filaments': template['filament_settings_id'],
            'bambuStudio': template.get('version'),
        }
        print(f'{pid:12} {template["printer_settings_id"]:32} {template["filament_settings_id"]}')
    index_path.write_text(json.dumps(dict(sorted(index.items())), indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main(sys.argv[1:])
