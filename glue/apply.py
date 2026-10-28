import json, os, shutil, hashlib
L='/root/sahtoutcms/cms/launcher'
src='/root/glue6.MPQ'
data=open(src,'rb').read()
sha=hashlib.sha256(data).hexdigest()
dst=L+'/files/glue/Data/deDE'
os.makedirs(dst,exist_ok=True)
open(dst+'/patch-deDE-6.MPQ','wb').write(data)
shutil.copy(L+'/manifest.json','/root/zum-loeschen/manifest.vor-glue.json')
m=json.load(open(L+'/manifest.json'))
m['glue']={'name':'Login-Oberfläche (Nachname)','files':[{'path':'Data/deDE/patch-deDE-6.MPQ','url':'https://wow.jedrimos.dedyn.io/launcher/files/glue/Data/deDE/patch-deDE-6.MPQ','size':len(data),'sha256':sha}]}
json.dump(m,open(L+'/manifest.json','w'),indent=1,ensure_ascii=False)
json.load(open(L+'/manifest.json'))
print('glue ok',len(data),sha[:16])
