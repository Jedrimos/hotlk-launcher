import shutil
p='/root/azerothcore-wotlk/lua_scripts/hotlk_names.lua'
s=open(p).read()
if 'function HotLK_Last' not in s:
    shutil.copy(p,'/root/zum-loeschen/hotlk_names.lua.vor-namesend')
    s+='\nfunction HotLK_Last(g) local d = names[g] return d and d[2] or "" end\n'
if 'function HotLK_SetLastDirect' not in s:
    s+='function HotLK_SetLastDirect(g, l) l = clean(l) if not l or l == "" then return end names[g] = { "", l } WorldDBExecute("REPLACE INTO hotlk_names (guid, first, last) VALUES (" .. g .. ", \'\', \'" .. l:gsub("\'", "\'\'") .. "\')") end\n'
open(p,'w').write(s)
shutil.copy('/root/ns.lua','/root/azerothcore-wotlk/lua_scripts/hotlk_namesend.lua')
print('ok')
