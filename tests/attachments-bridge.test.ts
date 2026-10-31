import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

// Exercise the exact stdlib helper sent to the remote host; no SSH, prompts or profile data.
function python(source: string): void {
  const result = spawnSync(
    'python3',
    ['-c', `import runpy\nb=runpy.run_path('scripts/hermes-bridge.py')\n${source}`],
    { encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);
}

describe('Hermes bridge private attachment staging', () => {
  it('stages private image bytes, checks digest, and releases only owned files after admission ack', () => {
    python(`
import tempfile,pathlib,hashlib,base64,stat
with tempfile.TemporaryDirectory() as directory:
 home=pathlib.Path(directory)
 uploads=b['AttachmentUploads'](home, {'images':True,'files':True})
 data=b'\\x89PNG\\r\\n\\x1a\\nimage bytes'
 ident=uploads.begin({'name':'image.png','mime':'image/png','size':len(data),'sha256':hashlib.sha256(data).hexdigest(),'session_id':'selected'})['upload_id']
 path=uploads.uploads[ident]['path']
 assert path.parent==home/'cache/images' and stat.S_IMODE(path.stat().st_mode)==0o600
 uploads.chunk({'upload_id':ident,'offset':0,'data_base64':base64.b64encode(data).decode()})
 result,native=uploads.finish({'upload_id':ident})
 assert native is None and result=={'path':str(path),'mime':'image/png'} and path.read_bytes()==data
 assert uploads.image_ids({'attachments':[result]})==[ident]
 uploads.release([ident])
 assert path.exists(), 'uncertain admission must keep staging'
 uploads.settled([ident]);assert not path.exists()
 untouched=home/'cache/images/user.png';untouched.write_bytes(b'user')
 uploads.close();assert untouched.read_bytes()==b'user'
`);
  });
  it('hands generic bytes to canonical file.attach without a caller-controlled remote path', () => {
    python(`
import tempfile,pathlib,hashlib,base64
with tempfile.TemporaryDirectory() as directory:
 uploads=b['AttachmentUploads'](directory, {'images':True,'files':True});data=b'hello file'
 ident=uploads.begin({'name':'report one.txt','mime':'application/octet-stream','size':len(data),'sha256':hashlib.sha256(data).hexdigest(),'session_id':'selected'})['upload_id']
 uploads.chunk({'upload_id':ident,'offset':0,'data_base64':base64.b64encode(data).decode()})
 result,native=uploads.finish({'upload_id':ident})
 assert result is None and native=={'session_id':'selected','name':'report one.txt','data_url':'data:application/octet-stream;base64,'+base64.b64encode(data).decode()}
 path=uploads.uploads[ident]['path'];uploads.settled([ident]);assert not path.exists()
 assert b['safe_result']('file.attach',{'attached':True,'ref_text':'@file:report.txt','path':'private','secret':'hidden'})=={'attached':True,'ref_text':'@file:report.txt'}
`);
  });
  it('rejects incomplete, corrupt, oversized, out-of-order or path-injected uploads and symlink roots', () => {
    python(`
import tempfile,pathlib,hashlib,base64
with tempfile.TemporaryDirectory() as directory:
 home=pathlib.Path(directory);uploads=b['AttachmentUploads'](home, {'images':True,'files':True})
 params={'name':'valid.txt','mime':'application/octet-stream','size':3,'sha256':hashlib.sha256(b'abc').hexdigest(),'session_id':'selected'}
 def rejected(call):
  try:call()
  except (ValueError,TypeError,KeyError):return
  raise AssertionError('invalid upload accepted')
 for change in [{'name':'../file'},{'path':'/outside'},{'size':10*1024*1024+1},{'mime':'image/svg+xml'}]:rejected(lambda change=change:uploads.begin({**params,**change}))
 ident=uploads.begin(params)['upload_id']
 rejected(lambda:uploads.finish({'upload_id':ident}))
 rejected(lambda:uploads.chunk({'upload_id':ident,'offset':1,'data_base64':'YWJj'}))
 rejected(lambda:uploads.chunk({'upload_id':ident,'offset':0,'data_base64':'!'}))
 uploads.chunk({'upload_id':ident,'offset':0,'data_base64':'eHl6'})
 rejected(lambda:uploads.finish({'upload_id':ident}))
 uploads.close();assert not list((home/'cache/companion-uploads').iterdir())
 (home/'cache/images').symlink_to(home/'cache/companion-uploads')
 rejected(lambda:uploads.begin({**params,'mime':'image/png'}))
`);
  });
  it('bounds batches and keeps normal websocket messages small while allowing only the internal file RPC size', () => {
    python(`
import tempfile,hashlib
with tempfile.TemporaryDirectory() as directory:
 uploads=b['AttachmentUploads'](directory, {'images':True,'files':True})
 params={'name':'file','mime':'application/octet-stream','size':10*1024*1024,'sha256':hashlib.sha256(b'x').hexdigest(),'session_id':'selected'}
 uploads.begin(params);uploads.begin(params)
 try:uploads.begin(params)
 except ValueError:pass
 else:raise AssertionError('total cap bypass')
 uploads.close()
 try:b['masked_frame'](b'x'*1_000_001)
 except ValueError:pass
 else:raise AssertionError('normal frame cap bypass')
 assert len(b['masked_frame'](b'x'*1_000_001,max_bytes=b['MAX_NATIVE_FRAME']))>1_000_001
`);
  });
});
