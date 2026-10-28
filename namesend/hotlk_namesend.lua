-- HotLK: Nachname an die Namensantwort (SMSG_NAME_QUERY_RESPONSE = 0x051) haengen
-- Wirkt dadurch ueber dem Kopf, im Chat, in Gruppe, Tooltip, /who ohne Addon.
local OP = 81
local SEND = 7
local dbg = 3
local function onSend(ev, pk, pl)
  local ok, a, b = pcall(function()
    if not HotLK_Last then return end
    local g = pk:ReadPackedGUID()
    local unk = pk:ReadUByte()
    if unk ~= 0 then return end
    local name = pk:ReadString()
    local realm = pk:ReadString()
    local race, gender, class = pk:ReadUByte(), pk:ReadUByte(), pk:ReadUByte()
    local decl = pk:ReadUByte()
    if dbg > 0 then dbg = dbg - 1; print("[namesend] guid=" .. tostring(g) .. " type=" .. type(g) .. " name=" .. tostring(name)) end
    if name:find(" ", 1, true) then return end
    local last = HotLK_Last(tonumber(g))
    if not last or last == "" then return end
    local n = CreatePacket(OP, 64)
    n:WritePackedGUID(g)
    n:WriteUByte(0)
    n:WriteString(name .. " " .. last)
    n:WriteString(realm)
    n:WriteUByte(race); n:WriteUByte(gender); n:WriteUByte(class); n:WriteUByte(decl)
    return false, n
  end)
  if not ok then print("[namesend] Fehler: " .. tostring(a)); return end
  if a == false then return false, b end
end
RegisterPacketEvent(OP, SEND, onSend)
print("[hotlk_namesend.lua] geladen")
