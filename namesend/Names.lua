if GetRealmName and GetRealmName() and GetRealmName() ~= "" and GetRealmName() ~= "Home of the Lich King" then return end -- HotLK Namen: Vor- und Nachname frei waehlbar, Anzeige in Tooltip + Zielfenster
-- Nur auf dem Realm "Home of the Lich King" aktiv, auf anderen Servern passiert nichts
if GetRealmName() ~= "Home of the Lich King" then return end

local PREFIX = "HOTLKN"
local cache = {}      -- [Charname] = { first=, last=, t= }
local pending = {}    -- [Charname] = Zeitpunkt der letzten Anfrage
local TTL, RETRY = 300, 20

local function full(name, d)
  if name and name:find(" ", 1, true) then return nil end
  if not d then return nil end
  if d.last and d.last ~= "" and name and name:find(d.last, 1, true) then return nil end
  local f = (d.first and d.first ~= "") and d.first or name
  if d.last and d.last ~= "" then return f .. " " .. d.last end
  if f ~= name then return f end
  return nil
end

local function request(name, force)
  if not name or name == "" or name:find(" ", 1, true) then return end
  local now = GetTime()
  local c = cache[name]
  if not force then
  if c and now - c.t < TTL then return end
  if pending[name] and now - pending[name] < RETRY then return end
  end
  pending[name] = now
  SendChatMessage("#hn get " .. name, "SAY")
end

pcall(RegisterCVar, "hotlkNames", "")
pcall(RegisterCVar, "hotlkPend", "")
local function HotLKN_Store(name, last) -- Anzeige in der Charakterwahl (Glue-Bildschirm liest die CVar)
  pcall(function()
    local s = GetCVar("Sound_VoiceChatOutputDriverName") or ""
    if s:sub(1, 6) == "HOTLK|" then s = s:sub(7) else s = "" end
    local key, t = strlower(name), {}
    for e in string.gmatch(s, "[^;]+") do local n = strmatch(e, "^(.-):"); if n and strlower(n) ~= key then t[#t + 1] = e end end
    if last and last ~= "" then t[#t + 1] = name .. ":" .. last end
    SetCVar("Sound_VoiceChatOutputDriverName", "HOTLK|" .. table.concat(t, ";"):gsub('"', ""))
  end)
end

-- Antworten vom Server
local ev = CreateFrame("Frame")
ev:RegisterEvent("CHAT_MSG_ADDON")
ev:RegisterEvent("PLAYER_TARGET_CHANGED")
ev:RegisterEvent("UPDATE_MOUSEOVER_UNIT")
ev:RegisterEvent("PLAYER_ENTERING_WORLD")
ev:SetScript("OnEvent", function(self, event, a1, a2)
  if event == "CHAT_MSG_ADDON" then
    if a1 ~= PREFIX then return end
    local kind, name, first, last, cost, allowed = strsplit("\t", a2 or "")
    if kind == "N" and name then
      cache[name] = { first = first or "", last = last or "", t = GetTime() }
if name == UnitName("player") then HotLKN_Store(name, last or "") end
      if name == UnitName("player") and cost and cost ~= "" then HotLKNames_cost = tonumber(cost); HotLKNames_allowed = (allowed == "1"); if HotLKNamesButton then if HotLKNames_allowed then HotLKNamesButton:Show() else HotLKNamesButton:Hide() end end; if HotLKNames_OnCost then HotLKNames_OnCost() end end
      pending[name] = nil
      HotLKNames_Refresh()
    end
  elseif event == "PLAYER_TARGET_CHANGED" then
    if UnitExists("target") and UnitIsPlayer("target") then request(UnitName("target")) end
    HotLKNames_Refresh()
  elseif event == "UPDATE_MOUSEOVER_UNIT" then
    if UnitExists("mouseover") and UnitIsPlayer("mouseover") then request(UnitName("mouseover")) end
  elseif event == "PLAYER_ENTERING_WORLD" then
    request(UnitName("player"))
    -- Namen aus der Charaktererstellung uebernehmen (CVar hotlkPend = "Charname~Vorname~Nachname")
    local pend
    for _, cv in ipairs({ "hotlkPend", "patchlist", "accountList", "characterList" }) do
      local okc, v = pcall(GetCVar, cv)
      if okc and v and v:sub(1, 6) == "HOTLK|" then pend = v:sub(7); break end
    end
    if pend and pend ~= "" then
      local cn, f1, l1 = strsplit("~", pend)
      if cn and UnitName("player") and strlower(cn) == strlower(UnitName("player")) then
        local waited = 0
        self:SetScript("OnUpdate", function(fr, el)
          waited = waited + el
          if waited < 4 then return end
          fr:SetScript("OnUpdate", nil)
          SendChatMessage("#hn set " .. (f1 or "") .. "~" .. (l1 or ""), "SAY")
          local me = UnitName("player")
          cache[me] = { first = f1 or "", last = l1 or "", t = GetTime() }
          HotLKNames_Refresh()
          for _, cv in ipairs({ "hotlkPend", "patchlist", "accountList", "characterList" }) do pcall(function() local x = GetCVar(cv); if x and x:sub(1, 6) == "HOTLK|" then SetCVar(cv, "") end end) end
          print("|cff33ccffHotLK:|r Dein Name aus der Charaktererstellung wurde gespeichert.")
        end)
      end
    end
  end
end)

function HotLKNames_Refresh()
  local n = UnitName("target")
  if n and UnitIsPlayer("target") then
    local t = full(n, cache[n])
    if t and TargetFrameTextureFrameName then TargetFrameTextureFrameName:SetText(t) end
  end
  local p = UnitName("player")
  local t = full(p, cache[p])
  if t and PlayerName then PlayerName:SetText(t) end
  if t and CharacterNameText and CharacterFrame and CharacterFrame:IsShown() then CharacterNameText:SetText(t) end
end

hooksecurefunc("TargetFrame_Update", HotLKNames_Refresh)
hooksecurefunc("PlayerFrame_Update", HotLKNames_Refresh)
if CharacterFrame then
  CharacterFrame:HookScript("OnShow", HotLKNames_Refresh)
  CharacterFrame:HookScript("OnEvent", HotLKNames_Refresh)
end
if PaperDollFrame_SetLevel then hooksecurefunc("PaperDollFrame_SetLevel", HotLKNames_Refresh) end

-- Tooltip
GameTooltip:HookScript("OnTooltipSetUnit", function(self)
  local _, unit = self:GetUnit()
  if not unit or not UnitIsPlayer(unit) then return end
  local n = UnitName(unit)
  local t = full(n, cache[n])
  local dd = cache[n]
  if t then
    local line = GameTooltipTextLeft1
    local old = line:GetText() or n
    if not (dd and dd.last and dd.last ~= "" and old:find(dd.last, 1, true)) then
      line:SetText((old:gsub(n, t, 1)))
    end
  end
end)

-- Eingabefenster
local DE = (GetLocale() == "deDE")
local T = {
  title  = DE and "Dein Nachname" or "Your last name",
  seen   = DE and "So sehen dich andere Spieler:" or "This is how others see you:",
  label  = DE and "Nachname" or "Last name",
  save   = DE and "Speichern" or "Save",
  cancel = DE and "Abbrechen" or "Cancel",
  button = DE and "Name" or "Name",
  loading= DE and "Preis wird geladen ..." or "Loading price ...",
  hint   = DE and "Leer lassen = Nachname entfernen (gratis).\nDein Vorname ist dein Charaktername. Ihn aenderst du beim Willkommens-NPC in einer Hauptstadt."
                or "Leave empty = remove last name (free).\nYour first name is your character name. Change it at the welcome NPC in a capital city.",
}
local f = CreateFrame("Frame", "HotLKNamesFrame", UIParent)
f:SetWidth(380); f:SetHeight(300); f:SetPoint("CENTER")
f:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background", edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
  tile = true, tileSize = 32, edgeSize = 32, insets = { left = 11, right = 12, top = 12, bottom = 11 } })
f:EnableMouse(true); f:SetMovable(true); f:RegisterForDrag("LeftButton")
f:SetScript("OnDragStart", f.StartMoving); f:SetScript("OnDragStop", f.StopMovingOrSizing)
f:SetFrameStrata("DIALOG"); f:Hide()
tinsert(UISpecialFrames, "HotLKNamesFrame")

local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
title:SetPoint("TOP", 0, -20); title:SetText(T.title)

local seen = f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
seen:SetPoint("TOP", 0, -52); seen:SetText(T.seen); seen:SetTextColor(0.7, 0.7, 0.7)
local pvName = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightLarge")
pvName:SetPoint("TOP", 0, -72); pvName:SetWidth(330); pvName:SetJustifyH("CENTER")

local line = f:CreateTexture(nil, "ARTWORK")
line:SetTexture(1, 1, 1, 0.12); line:SetHeight(1); line:SetPoint("TOPLEFT", 26, -108); line:SetPoint("TOPRIGHT", -26, -108)

local lbl = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
lbl:SetPoint("TOPLEFT", 30, -122); lbl:SetText(T.label)
local edit = CreateFrame("EditBox", "HotLKNamesEdit", f, "InputBoxTemplate")
edit:SetWidth(310); edit:SetHeight(24); edit:SetPoint("TOPLEFT", 36, -142)
edit:SetAutoFocus(false); edit:SetMaxLetters(36)

local price = f:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
price:SetPoint("TOP", 0, -180); price:SetWidth(330)
local hint = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
hint:SetPoint("TOP", 0, -208); hint:SetWidth(330); hint:SetJustifyH("CENTER"); hint:SetText(T.hint)

local function clean(text)
  text = (text or ""):gsub("[|#~\t%%<>]", ""); text = text:gsub("%s+", " ")
  return strtrim(text)
end

local function goldStr(c) return math.floor(c / 10000) .. " Gold" end

local function updatePrice()
  local c = HotLKNames_cost
  if HotLKNames_allowed then price:SetText("|cff33ff33" .. (DE and "Kostenlos (GM / Gruender)" or "Free (GM / founder)") .. "|r"); return end
  if c == nil then price:SetText("|cff999999" .. T.loading .. "|r"); return end
  if c <= 0 then price:SetText((DE and "Kosten: " or "Cost: ") .. "|cff33ff33" .. (DE and "gratis" or "free") .. "|r  " .. (DE and "(erste Aenderung)" or "(first change)")); return end
  local have = GetMoney()
  local col = (have >= c) and "|cffffd100" or "|cffff4040"
  local txt = (DE and "Kosten: " or "Cost: ") .. col .. goldStr(c) .. "|r"
  if have < c then txt = txt .. "\n|cffff4040" .. (DE and "Du hast nur " or "You only have ") .. goldStr(have) .. "|r" end
  price:SetText(txt)
end

local function updatePreview()
  local b = clean(edit:GetText())
  local me = UnitName("player")
  if b == "" then pvName:SetText(me)
  else pvName:SetText(me .. " |cffffd100" .. b .. "|r") end
  updatePrice()
end
edit:SetScript("OnTextChanged", updatePreview)
HotLKNames_OnCost = updatePreview

local function doSave()
  SendChatMessage("#hn set ~" .. clean(edit:GetText()), "SAY")
  f:Hide()
end
edit:SetScript("OnEnterPressed", doSave)
edit:SetScript("OnEscapePressed", function() f:Hide() end)

local save = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
save:SetWidth(120); save:SetHeight(26); save:SetPoint("BOTTOMLEFT", 45, 24); save:SetText(T.save)
save:SetScript("OnClick", doSave)
local close = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
close:SetWidth(120); close:SetHeight(26); close:SetPoint("BOTTOMRIGHT", -45, 24); close:SetText(T.cancel)
close:SetScript("OnClick", function() f:Hide() end)

f:SetScript("OnShow", function()
  local me = UnitName("player"); local d = cache[me]
  edit:SetText(d and d.last or ""); updatePreview(); edit:SetFocus()
  request(me, true)
end)

-- Knopf im Charakterfenster
local btn = CreateFrame("Button", "HotLKNamesButton", PaperDollFrame, "UIPanelButtonTemplate")
btn:SetWidth(56); btn:SetHeight(20)
btn:SetPoint("TOP", CharacterModelFrame, "TOP", 0, -6)
btn:SetFrameLevel(CharacterModelFrame:GetFrameLevel() + 6)
btn:SetText(T.button); btn:Hide()
btn:SetScript("OnClick", function() if f:IsShown() then f:Hide() else f:Show() end end)

SLASH_HOTLKNAMES1 = "/nachname"; SLASH_HOTLKNAMES2 = "/name"; SLASH_HOTLKNAMES3 = "/hn"
SlashCmdList["HOTLKNAMES"] = function()
  if not HotLKNames_allowed then print("|cff33ccffHotLK:|r " .. (DE and "Deinen Namen aenderst du beim Willkommens-NPC in einer Hauptstadt." or "Change your name at the welcome NPC in a capital city.")); return end
  if f:IsShown() then f:Hide() else f:Show() end
end

-- Namensplaketten (Taste V / Shift+V): Nachname anhaengen
local plates, nplates, acc = {}, -1, 0
local function nameRegion(pl)
  local r = { pl:GetRegions() }
  local fs
  for i = 1, #r do
    if r[i]:GetObjectType() == "FontString" then
      fs = fs or {}
      fs[#fs + 1] = r[i]
    end
  end
  -- erster FontString ist der Name, zweiter die Stufe
  return fs and fs[1]
end
local function isPlate(pl)
  if pl:GetName() or pl:GetObjectType() ~= "Frame" then return false end
  local r = select(2, pl:GetRegions())
  return r and r:GetObjectType() == "Texture" and r:GetTexture() == "Interface\\Tooltips\\Nameplate-Border"
end
local function groupRequests()
  if GetNumPartyMembers and GetNumPartyMembers() > 0 then
    for i = 1, 4 do local u = "party" .. i; if UnitExists(u) then request(UnitName(u)) end end
  end
  if GetNumRaidMembers and GetNumRaidMembers() > 0 then
    for i = 1, 40 do local u = "raid" .. i; if UnitExists(u) then request(UnitName(u)) end end
  end
end
local pf = CreateFrame("Frame")
pf:SetScript("OnUpdate", function(_, el)
  acc = acc + el
  if acc < 0.25 then return end
  acc = 0
  if HotLKDB and HotLKDB.plates == false then return end
  local n = WorldFrame:GetNumChildren()
  if n ~= nplates then
    nplates = n
    for _, c in ipairs({ WorldFrame:GetChildren() }) do
      if not plates[c] and isPlate(c) then plates[c] = true end
    end
  end
  groupRequests()
  for pl in pairs(plates) do
    if pl:IsShown() then
      local fs = nameRegion(pl)
      if fs then
        local t = fs:GetText()
        if t and t ~= pl.hlkSet then
          local d = cache[t]
          local f2 = d and full(t, d)
          if f2 then fs:SetText(f2); pl.hlkSet = fs:GetText() else pl.hlkSet = nil end
        end
      end
    end
  end
end)
