-- HotLK: Nachname serverseitig
--  1) CMSG_CHAR_CREATE (0x036): Name "Vorname~Nachname" -> Nachname merken, Name bereinigen
--  2) ON_CHARACTER_CREATE: Nachname beim neuen Charakter speichern
--  3) SMSG_CHAR_ENUM (0x03B): Nachname in der Charakterwahl anhaengen
--  4) SMSG_NAME_QUERY_RESPONSE (0x051): Nachname ueber Kopf, Chat, Gruppe, Tooltip
local RECV, SEND = 5, 7
local pending = {}
local nameGuid = {}

local function onCreateReq(ev, pk, pl)
  local ok, a, b = pcall(function()
    local size = pk:GetSize()
    local name = pk:ReadString()
    print("[namesend] Create: name='" .. name .. "' size=" .. tostring(size))
    if not name:find("~", 1, true) then return end
    local rest = {}
    for i = 1, 9 do rest[i] = pk:ReadUByte() end
    local first, last = name:match("^([^~]*)~(.*)$")
    last = (last or ""):gsub("[%c|#~%%<>;:]", ""):gsub("^%s+", ""):gsub("%s+$", "")
    if #last > 40 then last = last:sub(1, 40) end
    if last ~= "" then pending[first:lower()] = last end
    local n = CreatePacket(54, 64)
    n:WriteString(first)
    for i = 1, 9 do n:WriteUByte(rest[i]) end
    return false, n
  end)
  if not ok then print("[namesend] Create-Fehler: " .. tostring(a)); return end
  if a == false then return false, b end
end
-- RegisterPacketEvent(54, RECV, onCreateReq)  -- Client lehnt "~" im Namen ab

RegisterPlayerEvent(1, function(ev, p)
  nameGuid[p:GetName()] = nil
  local last = pending[p:GetName():lower()]
  if last and HotLK_SetLastDirect then
    pending[p:GetName():lower()] = nil
    HotLK_SetLastDirect(p:GetGUIDLow(), last)
    print("[namesend] Nachname gespeichert: " .. p:GetName() .. " " .. last)
  end
end)

local function onEnum(ev, pk, pl)
  local ok, a, b = pcall(function()
    if not HotLK_Last then return end
    local size = pk:GetSize()
    local cnt = pk:ReadUByte()
    if cnt == 0 then return end
    local chars, total, any = {}, 1, false
    for i = 1, cnt do
      local c = { guid = {} }
      for k = 1, 8 do c.guid[k] = pk:ReadUByte() end
      c.name = pk:ReadString()
      c.rest = {}
      for k = 1, 261 do c.rest[k] = pk:ReadUByte() end
      total = total + 8 + #c.name + 1 + 261
      -- guid (little endian, Spieler: High = 0) -> low
      local low = c.guid[1] + c.guid[2] * 256 + c.guid[3] * 65536 + c.guid[4] * 16777216
      c.last = HotLK_Last(low)
      if c.last and c.last ~= "" then any = true end
      chars[i] = c
    end
    if total ~= size or not any then return end
    local n = CreatePacket(59, size + 200)
    n:WriteUByte(cnt)
    for i = 1, cnt do
      local c = chars[i]
      for k = 1, 8 do n:WriteUByte(c.guid[k]) end
      n:WriteString((c.last and c.last ~= "") and (c.name .. " " .. c.last) or c.name)
      for k = 1, 261 do n:WriteUByte(c.rest[k]) end
    end
    return false, n
  end)
  if not ok then print("[namesend] Enum-Fehler: " .. tostring(a)); return end
  if a == false then return false, b end
end
-- RegisterPacketEvent(59, SEND, onEnum)  -- Hook kann kein neues Paket senden (kein Player)

local function lastByName(name)
  local g = nameGuid[name]
  if g == nil then
    local q = CharDBQuery("SELECT guid FROM characters WHERE name='" .. name:gsub("'", "''") .. "'")
    g = q and q:GetUInt32(0) or false
    nameGuid[name] = g
  end
  return g and HotLK_Last(g) or ""
end
local dbg = 60
local function onName(ev, pk, pl)
  local ok, a, b = pcall(function()
    if not HotLK_Last then return end
    local mask = pk:ReadUByte()
    local gb, low = {}, 0
    for i = 0, 7 do
      if mask % (2 ^ (i + 1)) >= 2 ^ i then
        local b = pk:ReadUByte(); gb[#gb + 1] = b
        if i < 4 then low = low + b * 256 ^ i end
      end
    end
    local g = low
    local unk = pk:ReadUByte()
    if unk ~= 0 then return end
    local name = pk:ReadString()
    local realm = pk:ReadString()
    local race, gender, class = pk:ReadUByte(), pk:ReadUByte(), pk:ReadUByte()
    local decl = pk:ReadUByte()
    if dbg > 0 then dbg = dbg - 1; print("[namesend] guid=" .. tostring(g) .. " type=" .. type(g) .. " name=" .. tostring(name)) end
    if name:find(" ", 1, true) then return end
    local last = HotLK_Last(low)
    if dbg > 0 then print("[namesend] last(" .. tostring(low) .. ")=" .. tostring(last)) end
    if (not last or last == "") then last = lastByName(name) end
    if not last or last == "" then return end
    local n = CreatePacket(81, 64)
    n:WriteUByte(mask)
    for i = 1, #gb do n:WriteUByte(gb[i]) end
    n:WriteUByte(0)
    n:WriteString(name .. " " .. last)
    n:WriteString(realm)
    n:WriteUByte(race); n:WriteUByte(gender); n:WriteUByte(class); n:WriteUByte(decl)
    print("[namesend] ersetze " .. name .. " -> " .. last .. " pl=" .. tostring(pl))
    if not pl then return end
    pl:SendPacket(n)
    return false
  end)
  if not ok then print("[namesend] Fehler: " .. tostring(a)); return end
  if a == false then return false end
end
RegisterPacketEvent(81, SEND, onName)
print("[hotlk_namesend.lua] geladen")
