import hashlib
import pathlib
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent / '.tools'
sdk = root / 'android-sdk'
xml = ET.fromstring(urllib.request.urlopen('https://dl.google.com/android/repository/repository2-3.xml', timeout=20).read())
for name, location in [('platforms;android-36', 'platforms/android-36'), ('build-tools;36.0.0', 'build-tools/36.0.0')]:
    if name.startswith('build-tools;') and (sdk / location / 'source.properties').exists():
        continue
    pkg = next(n for n in xml if n.attrib.get('path') == name)
    archive = next(n for n in pkg.findall('.//archive') if n.findtext('host-os') in ('windows', None))
    item = archive.find('complete')
    dest = root / (name.replace(';', '-') + '.zip')
    digest = hashlib.sha1()
    print(f'Downloading {name}', flush=True)
    with urllib.request.urlopen('https://dl.google.com/android/repository/' + item.findtext('url'), timeout=30) as response, dest.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            digest.update(chunk)
    if digest.hexdigest() != item.findtext('checksum'):
        raise RuntimeError(f'Checksum mismatch: {name}')
    out = sdk / location
    out.mkdir(parents=True, exist_ok=True)
    stale_metadata = out / 'package.xml'
    if stale_metadata.exists():
        stale_metadata.unlink()
    with zipfile.ZipFile(dest) as zipped:
        for member in zipped.infolist():
            rel = pathlib.PurePosixPath(member.filename)
            if rel.is_absolute() or '..' in rel.parts:
                raise RuntimeError('Invalid SDK archive path')
            target = out.joinpath(*rel.parts[1:])
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(zipped.read(member))
    print(f'Installed and verified {name}', flush=True)
