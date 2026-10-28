import json, os, shutil, hashlib, time
L='/root/sahtoutcms/cms/launcher'
data=open('/root/seam_p4.MPQ','rb').read()
dbc=open('/root/seam_TaxiPathNode.dbc','rb').read()
sha=hashlib.sha256(data).hexdigest()
assert sha.startswith('ea9662484dab34eb'),sha
B='/root/zum-loeschen/seam'
os.makedirs(B,exist_ok=True)
dst=L+'/files/heimat/Data/deDE/patch-deDE-4.MPQ'
shutil.copy(dst,B+'/patch-deDE-4.MPQ')
shutil.copy(L+'/manifest.json',B+'/manifest.json')
D='/var/lib/docker/volumes/azerothcore-wotlk_ac-client-data/_data/dbc/TaxiPathNode.dbc'
shutil.copy(D,B+'/TaxiPathNode.dbc')
open(dst,'wb').write(data)
m=json.load(open(L+'/manifest.json'))
n=0
for e in m['packs']['heimat']['files']:
    if e['path'].replace('\\','/').endswith('Data/deDE/patch-deDE-4.MPQ'):
        e['size']=len(data); e['sha256']=sha; n+=1
assert n==1
json.dump(m,open(L+'/manifest.json','w'),indent=1,ensure_ascii=False)
json.load(open(L+'/manifest.json'))
open(D,'wb').write(dbc)
print('seam ok',len(data),sha[:16],'dbc',len(dbc),os.path.getsize(D))
