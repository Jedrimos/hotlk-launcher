import re, json, shutil, zipfile, hashlib, os, sys, time
L = '/root/sahtoutcms/cms/launcher'
BK = '/root/zum-loeschen/nachname28'
os.makedirs(BK, exist_ok=True)
MPQ = '/root/n6.MPQ'
data = open(MPQ, 'rb').read()
sha = hashlib.sha256(data).hexdigest()
assert len(data) == 89864 and sha.startswith('eb4fe81a'), (len(data), sha)

# 1. Patch-Datei + Manifest
dst = L + '/files/heimat/Data/deDE/patch-deDE-6.MPQ'
shutil.copy(MPQ, dst)
mf = open(L + '/manifest.json', encoding='utf-8').read()
shutil.copy(L + '/manifest.json', BK + '/manifest.json')
if 'patch-deDE-6.MPQ' not in mf:
    m = re.search(r'([ \t]*)\{\s*"path": "Data/deDE/patch-deDE-4\.MPQ".*?\},', mf, re.S)
    assert m, 'patch-4-Eintrag nicht gefunden'
    blk = m.group(0)
    new = blk.replace('patch-deDE-4.MPQ', 'patch-deDE-6.MPQ')
    new = re.sub(r'"size": \d+', '"size": %d' % len(data), new)
    new = re.sub(r'"sha256": "[0-9a-f]+"', '"sha256": "%s"' % sha, new)
    mf = mf.replace(blk, blk + '\n' + new, 1)
    json.loads(mf)
    open(L + '/manifest.json', 'w', encoding='utf-8').write(mf)
print('manifest ok')

# 2. Addon Names.lua + toc
Z = L + '/files/addons/HotLK.zip'
shutil.copy(Z, BK + '/HotLK.zip.v391')
zin = zipfile.ZipFile(Z)
names = zin.namelist()
nm = zin.read('HotLK/Names.lua').decode('utf-8')
toc = zin.read('HotLK/HotLK.toc').decode('utf-8')
nl = '\r\n' if '\r\n' in nm else '\n'
if 'HotLKN_Store' not in nm:
    helper = nl.join([
        'pcall(RegisterCVar, "hotlkNames", "")',
        'pcall(RegisterCVar, "hotlkPend", "")',
        'local function HotLKN_Store(name, last) -- Anzeige in der Charakterwahl (Glue-Bildschirm liest die CVar)',
        '  pcall(function()',
        '    local s = GetCVar("hotlkNames") or ""',
        '    local key, t = strlower(name), {}',
        '    for e in string.gmatch(s, "[^;]+") do local n = strmatch(e, "^(.-):"); if n and strlower(n) ~= key then t[#t + 1] = e end end',
        '    if last and last ~= "" then t[#t + 1] = name .. ":" .. last end',
        '    SetCVar("hotlkNames", table.concat(t, ";"))',
        '  end)',
        'end',
        '', ''])
    a = '-- Antworten vom Server' + nl + 'local ev = CreateFrame("Frame")'
    assert nm.count(a) == 1
    nm = nm.replace(a, helper + a)
    b = 'cache[name] = { first = first or "", last = last or "", t = GetTime() }'
    assert nm.count(b) == 1
    nm = nm.replace(b, b + nl + 'if name == UnitName("player") then HotLKN_Store(name, last or "") end')
toc = toc.replace('## Version: 3.9.1', '## Version: 3.9.2')
tmp = Z + '.new'
with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zo:
    for n in names:
        if n.endswith('/'):
            zo.writestr(n, ''); continue
        d = zin.read(n)
        if n == 'HotLK/Names.lua': d = nm.encode('utf-8')
        if n == 'HotLK/HotLK.toc': d = toc.encode('utf-8')
        zo.writestr(n, d)
zin.close()
os.replace(tmp, Z)
print('addon ok', len(names))

# 3. Server-Lua: erste Nachnamen-Eingabe per Chat erlauben (kostenlos), weitere nur ueber den NPC
F = '/root/azerothcore-wotlk/lua_scripts/hotlk_names.lua'
s = open(F, encoding='utf-8').read()
shutil.copy(F, BK + '/hotlk_names.lua')
old = 'if not viaNpc and not free then return false, "npc" end'
if old in s:
    assert s.count(old) == 1
    s = s.replace(old, 'if not viaNpc and not free and ((HotLK_chg[g] or { 0, 0 })[1] or 0) > 0 then return false, "npc" end')
    open(F, 'w', encoding='utf-8').write(s)
print('lua ok')
