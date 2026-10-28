import zipfile, shutil, io
Z='/root/sahtoutcms/cms/launcher/files/addons/HotLK.zip'
shutil.copy(Z,'/root/zum-loeschen/HotLK.zip.v392b')
new=open('/root/Names.lua','rb').read()
zi=zipfile.ZipFile(Z); items=[(i.filename,zi.read(i.filename)) for i in zi.infolist()]; zi.close()
out=io.BytesIO(); zo=zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED)
for fn,d in items:
    if fn=='HotLK/Names.lua': d=new
    if fn=='HotLK/HotLK.toc': d=d.replace(b'## Version: 3.9.2',b'## Version: 3.9.4')
    zo.writestr(fn,d)
zo.close(); open(Z,'wb').write(out.getvalue()); print('zip ok')
