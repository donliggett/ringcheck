"""Regenerate public/npa.js (NANP area code -> state/province/country).

Uses the geocoding data shipped with the `phonenumbers` package, a Python port
of Google's libphonenumber (Apache License 2.0).

    pip install phonenumbers
    python scripts/gen-npa.py
"""
import json
import pathlib
import re
from collections import Counter

import phonenumbers
from phonenumbers import geocoder

FIX = {'CA': 'California', 'IL': 'Illinois', 'NY': 'New York', 'FL': 'Florida', 'PA': 'Pennsylvania',
       'TX': 'Texas', 'ON': 'Ontario', 'QC': 'Quebec', 'British Colombia': 'British Columbia',
       'Washington State': 'Washington'}
SAMPLES = ('201', '234', '345', '456', '567', '678', '789', '890', '300', '400', '500', '600', '700', '800',
           '900', '250', '350', '450', '650', '750', '850', '950', '222', '333', '444', '666', '777', '888',
           '999', '212', '313', '414', '616', '717', '818', '919')

out = {}
for npa in range(200, 1000):
    s = str(npa)
    if s[1:] == '11':
        continue
    c = Counter()
    for nxx in SAMPLES:
        d = geocoder.description_for_number(phonenumbers.parse('+1' + s + nxx + '0100'), 'en')
        if d:
            m = re.search(r',\s*([A-Z]{2})$', d)
            c[m.group(1) if m else d] += 1
    if c:
        out[s] = FIX.get(c.most_common(1)[0][0], c.most_common(1)[0][0])
for tf in ('800', '833', '844', '855', '866', '877', '888'):
    out[tf] = 'Toll-free'
out['900'] = 'Premium rate'

header = ('/* NANP area code -> state, province or country.\n'
          '   Generated from the geocoding data in libphonenumber (Apache License 2.0,\n'
          '   https://github.com/google/libphonenumber). Regenerate: python scripts/gen-npa.py */\n')
target = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'npa.js'
target.write_text(header + 'window.RC_NPA = ' + json.dumps(dict(sorted(out.items())), separators=(',', ':')) + ';\n')
print(f'wrote {len(out)} area codes to {target}')
