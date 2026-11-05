#!/usr/bin/env python3
"""Download CI artifacts and upload immutable GitHub Release assets with a short-lived App token.

Usage:
  python3 scripts/release/github_release_artifacts.py download <run-id> <output-directory>
  python3 scripts/release/github_release_artifacts.py upload <release-id> <file> [file ...]

The kt-ci-bot private key and installation tokens stay in memory and are never printed.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
import zipfile
from pathlib import Path

API = 'https://api.github.com'
UPLOADS = 'https://uploads.github.com'
INSTALLATION_ID = 178117456  # kt-aihub installation of kt-ci-bot; override via KITO_CI_INSTALLATION_ID.
REPOSITORY = 'deepseek-harness'


def app_module():
    command = subprocess.run(['which', 'kt-github-app'], capture_output=True, text=True, check=True).stdout.strip()
    if not command:
        raise RuntimeError('kt-github-app is required; install it before publishing artifacts')
    path = Path(command).resolve()
    spec = importlib.util.spec_from_file_location('kt_github_app', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def installation_token(app, permission: str) -> str:
    record = app.load_app('kt-ci-bot')
    coordinates = record['kt']
    app_id = app.kt_get('APP_ID', coordinates).strip()
    pem = app.kt_get('PRIVATE_KEY', coordinates)
    jwt = app.app_jwt(app_id, pem)
    import os
    installation = int(os.environ.get('KITO_CI_INSTALLATION_ID', INSTALLATION_ID))
    status, payload, _ = app.http_json(
        'POST', f'{API}/app/installations/{installation}/access_tokens', token=jwt,
        body={'repositories': [REPOSITORY], 'permissions': {permission: 'write' if permission == 'contents' else 'read'}},
    )
    if status != 201 or not payload.get('token'):
        raise RuntimeError(f'installation token failed: HTTP {status} {payload}')
    return payload['token']


def curl_json(token: str, url: str):
    result = subprocess.run([
        'curl', '-sS', '--fail', url,
        '-H', f'Authorization: Bearer {token}',
        '-H', 'Accept: application/vnd.github+json',
    ], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f'GitHub request failed: {result.stderr[:200]}')
    return json.loads(result.stdout)


def download_artifacts(run_id: str, output: Path) -> None:
    token = installation_token(app_module(), 'actions')
    artifacts = curl_json(token, f'{API}/repos/kt-aihub/{REPOSITORY}/actions/runs/{run_id}/artifacts')['artifacts']
    output.mkdir(parents=True, exist_ok=True)
    print('artifacts:', [(item.get('name'), item.get('size_in_bytes')) for item in artifacts])
    for artifact in artifacts:
        archive = output / f"{artifact['name']}.zip"
        subprocess.run([
            'curl', '-sSL', '--fail', '--max-time', '900',
            '-H', f'Authorization: Bearer {token}',
            '-H', 'Accept: application/vnd.github+json',
            artifact['archive_download_url'], '-o', str(archive),
        ], check=True)
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.infolist():
                target = output / member.filename
                if not target.exists():
                    bundle.extract(member, output)
                    print('extracted', target.name, target.stat().st_size)
        archive.unlink()


def upload_assets(release_id: str, files: list[Path]) -> None:
    token = installation_token(app_module(), 'contents')
    for source in files:
        if not source.is_file():
            raise RuntimeError(f'asset does not exist: {source}')
        url = f'{UPLOADS}/repos/kt-aihub/{REPOSITORY}/releases/{release_id}/assets?name={source.name}'
        response = source.with_suffix(source.suffix + '.upload.json')
        command = [
            'curl', '--http1.1', '--fail-with-body', '--silent', '--show-error',
            '--connect-timeout', '30', '--max-time', '1800', '--retry', '2', '--retry-all-errors', '--retry-delay', '5',
            '--location', '--max-redirs', '5', '-X', 'POST', url,
            '-H', f'Authorization: Bearer {token}',
            '-H', 'Accept: application/vnd.github+json',
            '-H', 'Content-Type: application/octet-stream',
            '--data-binary', f'@{source}', '-o', str(response), '-w', '%{http_code}',
        ]
        print(f'Uploading {source.name}: {source.stat().st_size} bytes', flush=True)
        result = subprocess.run(command, capture_output=True, text=True, timeout=1900)
        if result.returncode != 0:
            raise RuntimeError(result.stderr[:300])
        payload = json.loads(response.read_text())
        response.unlink()
        print(json.dumps({key: payload.get(key) for key in ['id', 'name', 'size', 'state', 'browser_download_url']}, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    download = sub.add_parser('download')
    download.add_argument('run_id')
    download.add_argument('output', type=Path)
    upload = sub.add_parser('upload')
    upload.add_argument('release_id')
    upload.add_argument('files', type=Path, nargs='+')
    args = parser.parse_args()
    if args.command == 'download':
        download_artifacts(args.run_id, args.output)
    else:
        upload_assets(args.release_id, args.files)


if __name__ == '__main__':
    main()
