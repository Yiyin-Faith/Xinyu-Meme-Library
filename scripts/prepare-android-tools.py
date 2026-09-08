"""Download Google's command-line tools into this project's .tools directory."""
import hashlib
import pathlib
import platform
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent / '.tools'
root.mkdir(exist_ok=True)
xml = ET.fromstring(urllib.request.urlopen('https://dl.google.com/android/repository/repository2-1.xml', timeout=20).read())
pkg = next(node for node in xml if node.attrib.get('path') == 'cmdline-tools;latest')
host = {'Windows': 'windows', 'Linux': 'linux', 'Darwin': 'macosx'}.get(platform.system())
if not host:
    raise RuntimeError(f'Unsupported host operating system: {platform.system()}')
archive = next(node for node in pkg.findall('.//archive') if node.findtext('host-os') == host)
complete = archive.find('complete')
url = complete.findtext('url')
expected = complete.findtext('checksum')
archive_path = root / 'android-commandline.zip'
digest = hashlib.sha1()
with urllib.request.urlopen('https://dl.google.com/android/repository/' + url, timeout=30) as response, archive_path.open('wb') as output:
    total = 0
    while chunk := response.read(1024 * 1024):
        output.write(chunk)
        digest.update(chunk)
        total += len(chunk)
        if total % (20 * 1024 * 1024) == 0:
            print(f'Android tools downloaded: {total // (1024 * 1024)} MB', flush=True)
if digest.hexdigest() != expected:
    raise RuntimeError('Google repository checksum does not match')
destination = root / 'android-sdk' / 'cmdline-tools' / 'latest'
destination.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(archive_path) as zipped:
    for item in zipped.infolist():
        rel = pathlib.PurePosixPath(item.filename)
        if not rel.parts or rel.parts[0] != 'cmdline-tools' or '..' in rel.parts:
            raise RuntimeError('Unexpected archive path')
        target = destination.joinpath(*rel.parts[1:])
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zipped.read(item))
print('Google Android command-line tools verified and extracted.', flush=True)
