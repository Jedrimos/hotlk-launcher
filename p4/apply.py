import json, os, shutil, hashlib
L='/root/sahtoutcms/cms/launcher'
data=open('/root/p4g.MPQ','rb').read()
sha=hashlib.sha256(data).hexdigest()
dst=L+'/files/heimat/Data/deDE/patch-deDE-4.MPQ'
os.makedirs('/root/zum-loeschen/p4glue',exist_ok=True)
shutil.copy(dst,'/root/zum-loeschen/p4glue/patch-deDE-4.MPQ')
shutil.copy(L+'/manifest.json','/root/zum-loeschen/p4glue/manifest.json')
open(dst,'wb').write(data)
m=json.load(open(L+'/manifest.json'))
n=0
for e in m['packs']['heimat']['files']:
    if e['path'].replace('\\','/').endswith('Data/deDE/patch-deDE-4.MPQ'):
        e['size']=len(data); e['sha256']=sha; n+=1
assert n==1
m.pop('glue',None)
json.dump(m,open(L+'/manifest.json','w'),indent=1,ensure_ascii=False)
json.load(open(L+'/manifest.json'))
shutil.rmtree(L+'/files/glue',ignore_errors=True)
print('p4 ok',len(data),sha[:16])
