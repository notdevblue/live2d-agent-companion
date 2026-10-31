#!/usr/bin/env python3
"""Same-user Hermes native connection over SSH. Standard library only; no service management.
stdin/out are bounded JSON lines. Ephemeral tickets never leave this remote process.
"""
import base64
import hashlib
import json
import os
import pathlib
import re
import select
import socket
import struct
import sys
import urllib.parse

MAX_FRAME = 1_000_000
MAX_NATIVE_FRAME = 16_000_000  # History sidecars are discarded on-host before the smaller SSH boundary.
METHODS = {'gateway.capabilities', 'session.create', 'session.list', 'session.resume', 'session.events.since',
           'session.history', 'prompt.submit', 'prompt.receipt', 'prompt.cancel', 'session.interrupt', 'approval.respond'}
EVENT_TYPES = {'message.start', 'message.delta', 'message.complete', 'tool.start', 'tool.complete',
               'tool.started', 'tool.completed', 'approval.request', 'approval.settled', 'session.replay_gap'}


def output(value):
    data = json.dumps(value, ensure_ascii=True, separators=(',', ':'))
    if len(data) > MAX_FRAME:
        raise ValueError('response_size')
    sys.stdout.write(data + '\n')
    sys.stdout.flush()


def control(home, verb, params=None):
    path = home / 'gateway.sock'
    if not path.exists():
        path = pathlib.Path((home / 'gateway.sock.path').read_text().strip())
    sock = socket.socket(socket.AF_UNIX)
    sock.settimeout(10)
    try:
        sock.connect(str(path))
        request = {'protocol': 1, 'verb': verb}
        if params is not None:
            request['params'] = params
        sock.sendall(json.dumps(request).encode() + b'\n')
        with sock.makefile('rb') as reader:
            raw = reader.readline(MAX_FRAME + 1)
        if len(raw) > MAX_FRAME:
            raise ValueError('response_size')
        response = json.loads(raw)
        if response.get('ok') is not True:
            raise ValueError('control_refused')
        return response['result']
    finally:
        sock.close()


def masked_frame(payload, opcode=1):
    data = payload.encode() if isinstance(payload, str) else payload
    if len(data) > MAX_FRAME:
        raise ValueError('request_size')
    mask = os.urandom(4)
    n = len(data)
    header = bytes([128 | opcode, 128 | n]) if n < 126 else (
        bytes([128 | opcode, 254]) + struct.pack('!H', n) if n < 65536 else
        bytes([128 | opcode, 255]) + struct.pack('!Q', n))
    return header + mask + bytes(value ^ mask[index % 4] for index, value in enumerate(data))


def safe_prompt(prompt):
    return {key: prompt[key] for key in ('kind', 'prompt_id', 'execution_generation', 'command',
            'description', 'choices', 'timeout_s') if key in prompt}


def safe_receipt(receipt):
    return {key: receipt[key] for key in ('admission_id', 'ref', 'sequence', 'status', 'outcome',
            'authority_epoch', 'execution_generation', 'input_id') if key in receipt}


def safe_result(method, result):
    if not isinstance(result, dict):
        raise ValueError('invalid_response')
    if method == 'session.list':
        return {'sessions': [{key: row[key] for key in ('id', 'session_id', 'resolved_id', 'title',
                'source', 'running', 'execution_state') if key in row} for row in result.get('sessions', [])]}
    if method == 'session.history':
        # Native display projection has already removed hidden scaffolding. Never forward its
        # reasoning/detail sidecars, tool cards, metadata, images or system messages.
        messages = []
        for index, row in enumerate(result.get('messages', [])):
            if not isinstance(row, dict) or row.get('role') not in ('user', 'assistant'):
                continue
            text = row.get('text')
            if row.get('display_kind') == 'hidden' or not isinstance(text, str) or not text.strip():
                continue
            if len(text) > 256_000:
                raise ValueError('history_message_size')
            row_id = row.get('row_id')
            ident = 'row:' + str(row_id) if isinstance(row_id, int) else 'position:' + str(index)
            messages.append({'id': ident, 'role': row['role'], 'text': text})
        return {'messages': messages}
    if method in ('session.resume', 'session.create'):
        # History is required internally by Hermes attach. Discard it here, on the host, before SSH.
        return {**{key: result[key] for key in ('session_id', 'stored_session_id', 'running',
                'execution_generation', 'replay_epoch', 'last_sequence', 'subscription_id') if key in result},
                'pending': [safe_receipt(row) for row in result.get('pending', [])],
                'prompts': [safe_prompt(row) for row in result.get('prompts', [])]}
    if method == 'prompt.receipt':
        clean = safe_receipt(result)
        if isinstance(result.get('result'), dict):
            clean['result'] = {key: result['result'][key] for key in ('final_response', 'completed',
                'interrupted', 'failed', 'partial') if key in result['result']}
        return clean
    if method in ('prompt.submit', 'prompt.cancel'):
        return safe_receipt(result)
    if method == 'session.events.since':
        return {**{key: result[key] for key in ('last_sequence', 'replay_epoch', 'truncated',
                'snapshot_required') if key in result}, 'events': [safe_event(row) for row in result.get('events', []) if safe_event(row)]}
    if method == 'session.interrupt':
        return {key: result[key] for key in ('ref', 'execution_generation', 'execution_state') if key in result}
    if method == 'approval.respond':
        return {key: result[key] for key in ('status', 'prompt_id') if key in result}
    return {'per_session_exclusive_submit': result.get('per_session_exclusive_submit') is True}


def safe_event(frame):
    if frame.get('method') != 'event':
        if 'type' in frame and 'payload' in frame:
            frame = {'method': 'event', 'params': frame}
        else:
            return None
    params = frame.get('params', {})
    if params.get('type') not in EVENT_TYPES:
        return None
    payload = params.get('payload') or {}
    # Deliberately omit reasoning, tool arguments/output, transcript/history and raw diagnostics.
    event_type = params['type']
    if event_type == 'message.delta':
        allowed = ('text',)
    elif event_type == 'message.complete':
        allowed = ('text', 'content', 'status', 'outcome', 'admission_id')
    elif event_type.startswith('tool.'):
        allowed = ('name', 'tool', 'tool_name', 'tool_id', 'tool_call_id', 'call_id')
    elif event_type == 'approval.request':
        allowed = ('kind', 'prompt_id', 'execution_generation', 'command', 'description', 'choices', 'timeout_s')
    elif event_type == 'approval.settled':
        allowed = ('prompt_id', 'execution_generation')
    elif event_type == 'session.replay_gap':
        allowed = ('latest_seq',)
    else:
        allowed = ()
    return {'jsonrpc': '2.0', 'method': 'event', 'params': {
        **{key: params[key] for key in ('type', 'session_id', 'seq', 'replay_epoch', 'admission_id',
            'execution_generation') if key in params},
        'payload': {key: payload[key] for key in allowed if key in payload}}}


def main():
    initial = sys.stdin.buffer.readline(4097)
    if len(initial) > 4096:
        raise ValueError('request_size')
    config = json.loads(initial)
    profile = config.get('profile')
    if not isinstance(profile, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}', profile):
        raise ValueError('profile')
    home = pathlib.Path.home() / '.hermes'
    if profile != 'default':
        home = home / 'profiles' / profile
    descriptor = control(home, 'identify')
    if descriptor.get('state') != 'ready' or descriptor.get('hermes_home') != str(home):
        raise ValueError('runtime_identity')
    origin = urllib.parse.urlsplit(descriptor['api_origin'])
    if origin.scheme != 'http' or origin.hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise ValueError('runtime_origin')
    grant = control(home, 'session-ticket', {'profile_id': str(home), 'instance_id': descriptor['instance_id'],
                    'purpose': 'interactive', 'scope': 'profile'})
    sock = socket.create_connection((origin.hostname, origin.port), timeout=15)
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall((f'GET /api/ws HTTP/1.1\r\nHost: {origin.hostname}:{origin.port}\r\nUpgrade: websocket\r\n'
                  f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n'
                  f'Sec-WebSocket-Protocol: hermes-gateway-v1, hermes-gateway-ticket.{grant["ticket"]}\r\n\r\n').encode())
    del grant
    buffered = b''
    while b'\r\n\r\n' not in buffered:
        chunk = sock.recv(4096)
        if not chunk:
            raise EOFError('upgrade_closed')
        buffered += chunk
        if len(buffered) > 16384:
            raise ValueError('upgrade_size')
    header, buffered = buffered.split(b'\r\n\r\n', 1)
    expected = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
    headers = dict(line.decode().split(':', 1) for line in header.split(b'\r\n')[1:] if b':' in line)
    headers = {name.lower(): value.strip() for name, value in headers.items()}
    if not header.startswith(b'HTTP/1.1 101 ') or headers.get('sec-websocket-accept') != expected or headers.get('sec-websocket-protocol') != 'hermes-gateway-v1':
        raise ValueError('upgrade_refused')
    sock.settimeout(15)
    output({'kind': 'ready', 'profile': profile, 'profileId': str(home), 'instanceId': descriptor['instance_id'], 'protocol': 'hermes-gateway-v1'})
    waiting = {}
    stdin_buffer = b''
    fragments = b''
    fragment_opcode = None
    while True:
        # Parse every complete frame before blocking for more bytes.
        while len(buffered) >= 2:
            first, second = buffered[:2]
            length, offset = second & 127, 2
            if length == 126:
                if len(buffered) < 4: break
                length, offset = struct.unpack('!H', buffered[2:4])[0], 4
            elif length == 127:
                if len(buffered) < 10: break
                length, offset = struct.unpack('!Q', buffered[2:10])[0], 10
            if length > MAX_NATIVE_FRAME or second & 128:
                raise ValueError('invalid_frame')
            if len(buffered) < offset + length: break
            data, buffered = buffered[offset:offset+length], buffered[offset+length:]
            opcode = first & 15
            if opcode == 8: return
            if opcode == 9:
                sock.sendall(masked_frame(data, 10)); continue
            if opcode == 10: continue
            if opcode not in (0, 1): raise ValueError('invalid_frame')
            if opcode == 1:
                if fragment_opcode is not None: raise ValueError('invalid_frame')
                fragment_opcode = opcode
            elif fragment_opcode is None: raise ValueError('invalid_frame')
            fragments += data
            if len(fragments) > MAX_NATIVE_FRAME: raise ValueError('response_size')
            if not first & 128: continue
            frame = json.loads(fragments.decode('utf-8')); fragments, fragment_opcode = b'', None
            if frame.get('method') == 'gateway.ping':
                sock.sendall(masked_frame(json.dumps({'jsonrpc': '2.0', 'method': 'gateway.pong', 'params': {}}))); continue
            if 'id' in frame and frame.get('id') in waiting:
                method = waiting.pop(frame['id'])
                if 'error' in frame:
                    reason = (frame['error'].get('data') or {}).get('reason')
                    safe_reason = reason if reason in ('invalid_params', 'permission_denied', 'profile_mismatch', 'not_found') else 'native_rpc_refused'
                    output({'kind': 'response', 'id': frame['id'], 'error': {'code': frame['error'].get('code'), 'reason': safe_reason}})
                else:
                    output({'kind': 'response', 'id': frame['id'], 'result': safe_result(method, frame.get('result'))})
            elif frame.get('method') == 'event':
                event = safe_event(frame)
                if event: output({'kind': 'event', 'frame': event})
            elif 'id' in frame and 'method' in frame:
                # Unsupported server request never grants tool/local machine authority.
                sock.sendall(masked_frame(json.dumps({'jsonrpc':'2.0','id':frame['id'],'error':{'code':-32601,'message':'Unsupported host request'}})))
        readable, _, _ = select.select([sock, 0], [], [], 30)
        if sock in readable:
            chunk = sock.recv(65536)
            if not chunk: return
            buffered += chunk
            if len(buffered) > MAX_NATIVE_FRAME + 65536: raise ValueError('response_size')
        if 0 in readable:
            chunk = os.read(0, 65536)
            if not chunk:
                sock.sendall(masked_frame(b'', 8)); return
            stdin_buffer += chunk
            if len(stdin_buffer) > MAX_FRAME: raise ValueError('request_size')
            while b'\n' in stdin_buffer:
                line, stdin_buffer = stdin_buffer.split(b'\n', 1)
                command = json.loads(line)
                ident, method, params = command.get('id'), command.get('method'), command.get('params')
                if not isinstance(ident, int) or method not in METHODS or not isinstance(params, dict) or len(waiting) >= 32:
                    raise ValueError('invalid_command')
                waiting[ident] = method
                sock.sendall(masked_frame(json.dumps({'jsonrpc':'2.0','id':ident,'method':method,'params':params})))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Neither tracebacks nor raw server errors may expose credentials/history.
        output({'kind': 'error', 'code': 'hermes_bridge_unavailable'})
        sys.exit(1)
