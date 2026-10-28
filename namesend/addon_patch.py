import zipfile, shutil, io, re, sys
Z='/root/sahtoutcms/cms/launcher/files/addons/HotLK.zip'
def patch(names, toc):
    a='local function full(name, d)\n  if not d then return nil end'
    b='local function full(name, d)\n  if name and name:find(" ", 1, true) then return nil end -- Server haengt den Nachnamen schon an\n  if not d then return nil end'
    assert a in names or b in names
    names=names.replace(a,b)
    c='local function request(name, force)\n  if not name or name == "" then return end'
    d='local function request(name, force)\n  if not name or name == "" or name:find(" ", 1, true) then return end'
    assert c in names or d in names
    names=names.replace(c,d)
    toc=toc.replace('## Version: 3.9.2','## Version: 3.9.3')
    return names, toc
if __name__=='__main__':
    shutil.copy(Z,'/root/zum-loeschen/HotLK.zip.v392')
    zi=zipfile.ZipFile(Z); items=[(i,zi.read(i.filename)) for i in zi.infolist()]; zi.close()
    out=io.BytesIO(); zo=zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED)
    for i,data in items:
        if i.filename=='HotLK/Names.lua':
            n,_=patch(data.decode('utf8'),''); data=n.encode('utf8')
        elif i.filename=='HotLK/HotLK.toc':
            _,t=patch('local function full(name, d)\n  if not d then return nil end\nlocal function request(name, force)\n  if not name or name == "" then return end',data.decode('utf8')); data=t.encode('utf8')
        zo.writestr(i.filename,data)
    zo.close(); open(Z,'wb').write(out.getvalue()); print('ok')
