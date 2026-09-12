-- @description DBK Stage Control Export
-- @version 0.3.11
-- @about
--   Collects duration, tempo map, sections, lyrics, chords, and selected stems
--   from the current REAPER project and writes song.json plus audio for DBK.
--
--   Track conventions:
--     SECTION / LYRICS / CHORDS / PATTERN  name match is case-insensitive
--     CLICK and stem tracks must be named exactly, case-sensitive:
--       CLICK, KICK, DRUMS, PERC, BASS, KEYS, PLUCK, STRING, MELODY, CHOIR, GUITAR
--       "Drums" or "string" is ignored. Children of a DRUMS/STRING folder are not
--       selected; they are mixed through that folder and the master bus.
--     NOTA     muted for Master.mp3 (guide / score audio; not part of the mix)
--     NEXT     project marker → nextSongAt (when PLAY_NEXT starts the following song)
--     MASTER   always available → Master.mp3 (full mix, 128 kbps CBR; CLICK and NOTA muted)
--     CLICK    if present → Click.flac through master bus (44.1 kHz 16-bit)
--     KICK, DRUMS, ... → one Kick.flac, Drums.flac, ... through master bus
--
--   Key, scale, style, and kıta are chosen in the exporter (not from an INFO track).
--   Infos and chart tracks are always written when present. Audio include
--   checkboxes are stored in the REAPER project and written again after Export.
--
--   Duration is the project end (ruler / =END / last marker before leftover
--   items or regions), not leftover content after that point.
--
--   Item text is taken from item notes, then from the active take name.
--
--   Install: Actions → Show action list → ReaScript: Load → this file.
--            Optionally add it to a toolbar or keyboard shortcut.

if _G.DBK_STAGE_CONTROL_EXPORT_RUNNING then
  return
end
_G.DBK_STAGE_CONTROL_EXPORT_RUNNING = true

local EXT_NS = "DBKStageControl"

local STEM_SPECS = {
  { key = "KICK", file = "Kick" },
  { key = "DRUMS", file = "Drums" },
  { key = "PERC", file = "Perc" },
  { key = "BASS", file = "Bass" },
  { key = "KEYS", file = "Keys" },
  { key = "PLUCK", file = "Pluck" },
  { key = "STRING", file = "String" },
  { key = "MELODY", file = "Melody" },
  { key = "CHOIR", file = "Choir" },
  { key = "GUITAR", file = "Guitar" }
}

local STEM_KEYS = {}
for _, spec in ipairs(STEM_SPECS) do
  STEM_KEYS[spec.key] = true
end

local KEY_EMPTY = " "
local KEY_TONES = { KEY_EMPTY, "A", "B", "C", "D", "E", "F", "G" }
local KEY_ACC = { "#", "b", "" }
local KEY_SCALES = { KEY_EMPTY, "CARGAH", "HICAZ", "KURDI", "MINOR", "USSAK" }
local KEY_STYLES = {
  KEY_EMPTY,
  "ANKARA",
  "ATATURK",
  "AZERI",
  "BESTE",
  "CIFTE",
  "HALAY",
  "HORON",
  "MID",
  "ROMAN",
  "RUMELI",
  "SLOW",
  "TEKE",
  "TEREKEME",
  "TURKCU",
  "ZEYBEK"
}
local LIBRARY_SONGS = "/Users/md/Projects/dbk-stage-control/library/songs"

local WIN_W, WIN_H = 400, 800

local COL = {
  bg = { 22, 22, 26 },
  panel = { 36, 36, 42 },
  panel2 = { 48, 48, 56 },
  border = { 72, 72, 82 },
  text = { 232, 232, 236 },
  muted = { 148, 148, 158 },
  accent = { 232, 176, 72 },
  accent_dim = { 90, 68, 28 },
  ok = { 96, 196, 132 },
  warn = { 232, 156, 64 },
  err = { 220, 88, 88 },
  btn = { 232, 176, 72 },
  btn_text = { 22, 22, 26 },
  hover = { 58, 58, 68 }
}

local function setcol(rgb, a)
  gfx.r, gfx.g, gfx.b = rgb[1] / 255, rgb[2] / 255, rgb[3] / 255
  gfx.a = a or 1
end

local function fill_rect(x, y, w, h, rgb, a)
  setcol(rgb, a)
  gfx.rect(x, y, w, h, 1)
end

local function stroke_rect(x, y, w, h, rgb, a)
  setcol(rgb, a)
  gfx.rect(x, y, w, h, 0)
end

local function round(n, digits)
  local m = 10 ^ (digits or 6)
  return math.floor(n * m + 0.5) / m
end

local function trim(s)
  s = tostring(s or "")
  return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function is_blank_opt(v)
  return v == nil or v == "" or v == KEY_EMPTY
end

local function proj_get(key)
  local ok, val = reaper.GetProjExtState(0, EXT_NS, key)
  if (ok == 1 or ok == true) and val ~= nil and val ~= "" then
    return val
  end
  return nil
end

local function proj_set(key, value)
  reaper.SetProjExtState(0, EXT_NS, key, tostring(value or ""))
end

local function host_font()
  local os = reaper.GetOS()
  if os:match("Win") then
    return "Segoe UI"
  end
  if os:match("OSX") or os:match("macOS") or os:match("Other") then
    return "Helvetica"
  end
  return "Arial"
end

local FONT = host_font()

local function set_font(px)
  gfx.setfont(1, FONT, px)
end

local function text_at(x, y, str, rgb, clip_r, clip_b)
  setcol(rgb)
  gfx.x, gfx.y = x, y
  if clip_r then
    gfx.drawstr(str, 0, clip_r, clip_b or (y + 64))
  else
    gfx.drawstr(str)
  end
end

local function text_in_box(x, y, w, h, str, rgb, align_right)
  set_font(15)
  setcol(rgb)
  local tw, th = gfx.measurestr(str)
  local tx = align_right and (x + w - tw - 10) or (x + 10)
  local ty = y + (h - th) / 2
  gfx.x, gfx.y = tx, ty
  gfx.drawstr(str, 0, x + w - 6, y + h)
end

--------------------------------------------------------------------------------
-- JSON
--------------------------------------------------------------------------------

local function json_str(s)
  s = tostring(s or "")
  s = s:gsub("\\", "\\\\")
  s = s:gsub('"', '\\"')
  s = s:gsub("\b", "\\b")
  s = s:gsub("\f", "\\f")
  s = s:gsub("\n", "\\n")
  s = s:gsub("\r", "\\r")
  s = s:gsub("\t", "\\t")
  s = s:gsub("[%z\1-\31]", function(c)
    return string.format("\\u%04x", string.byte(c))
  end)
  return '"' .. s .. '"'
end

local function json_num(n)
  if type(n) ~= "number" or n ~= n or n == math.huge or n == -math.huge then
    return "0"
  end
  if n == math.floor(n) and math.abs(n) < 1e12 then
    return string.format("%.0f", n)
  end
  local s = string.format("%.6f", n)
  s = s:gsub("0+$", ""):gsub("%.$", "")
  return s
end

local function encode_tempo_map(map)
  local lines = { "[" }
  for i, p in ipairs(map) do
    local comma = i < #map and "," or ""
    lines[#lines + 1] = string.format(
      '    { "time": %s, "measure": %s, "bpm": %s, "numerator": %s, "denominator": %s }%s',
      json_num(p.time),
      json_num(p.measure),
      json_num(p.bpm),
      json_num(p.numerator),
      json_num(p.denominator),
      comma
    )
  end
  lines[#lines + 1] = "  ]"
  return table.concat(lines, "\n")
end

local function encode_sections(sections)
  if #sections == 0 then
    return "[]"
  end
  local lines = { "[" }
  for i, s in ipairs(sections) do
    local comma = i < #sections and "," or ""
    lines[#lines + 1] = string.format(
      '    { "name": %s, "start": %s, "end": %s }%s',
      json_str(s.name),
      json_num(s.start),
      json_num(s["end"]),
      comma
    )
  end
  lines[#lines + 1] = "  ]"
  return table.concat(lines, "\n")
end

local function encode_timed(items)
  if #items == 0 then
    return "[]"
  end
  local lines = { "[" }
  for i, item in ipairs(items) do
    local comma = i < #items and "," or ""
    lines[#lines + 1] = string.format(
      '    { "time": %s, "end": %s, "measure": %s, "beat": %s, "text": %s }%s',
      json_num(item.time),
      json_num(item.finish),
      json_num(item.measure),
      json_num(item.beat),
      json_str(item.text),
      comma
    )
  end
  lines[#lines + 1] = "  ]"
  return table.concat(lines, "\n")
end

local function encode_pattern_notes(notes)
  if not notes or #notes == 0 then
    return "[]"
  end
  local lines = { "[" }
  for i, n in ipairs(notes) do
    local comma = i < #notes and "," or ""
    lines[#lines + 1] = string.format(
      '        { "time": %s, "end": %s, "pitch": %s, "channel": %s, "velocity": %s, "measure": %s, "beat": %s, "numerator": %s, "denominator": %s }%s',
      json_num(n.time),
      json_num(n.finish),
      json_num(n.pitch),
      json_num(n.channel),
      json_num(n.velocity),
      json_num(n.measure),
      json_num(n.beat),
      json_num(n.numerator),
      json_num(n.denominator),
      comma
    )
  end
  lines[#lines + 1] = "      ]"
  return table.concat(lines, "\n")
end

local function encode_patterns(items)
  if #items == 0 then
    return "[]"
  end
  local lines = { "[" }
  for i, item in ipairs(items) do
    local comma = i < #items and "," or ""
    lines[#lines + 1] = string.format(
      '    { "text": %s, "time": %s, "end": %s, "length": %s, "measure": %s, "beat": %s, "numerator": %s, "denominator": %s, "notes": %s }%s',
      json_str(item.text),
      json_num(item.time),
      json_num(item.finish),
      json_num(item.length),
      json_num(item.measure),
      json_num(item.beat),
      json_num(item.numerator),
      json_num(item.denominator),
      encode_pattern_notes(item.notes),
      comma
    )
  end
  lines[#lines + 1] = "  ]"
  return table.concat(lines, "\n")
end

local function encode_chords(items)
  if #items == 0 then
    return "[]"
  end
  local lines = { "[" }
  for i, item in ipairs(items) do
    local comma = i < #items and "," or ""
    local extra = ""
    if item.notes and #item.notes > 0 then
      extra = ', "notes": ' .. encode_pattern_notes(item.notes)
    end
    lines[#lines + 1] = string.format(
      '    { "time": %s, "end": %s, "measure": %s, "beat": %s, "text": %s%s }%s',
      json_num(item.time),
      json_num(item.finish),
      json_num(item.measure),
      json_num(item.beat),
      json_str(item.text),
      extra,
      comma
    )
  end
  lines[#lines + 1] = "  ]"
  return table.concat(lines, "\n")
end

local function encode_assets(assets)
  if #assets == 0 then
    return "[]"
  end
  local lines = { "[" }
  for i, a in ipairs(assets) do
    local comma = i < #assets and "," or ""
    local extra = ""
    if a.role then
      extra = extra .. string.format(', "role": %s', json_str(a.role))
    end
    if a.audioRole then
      extra = extra .. string.format(', "audioRole": %s', json_str(a.audioRole))
    end
    if a.bus then
      extra = extra .. string.format(', "bus": %s', json_str(a.bus))
    end
    if a.label then
      extra = extra .. string.format(', "label": %s', json_str(a.label))
    end
    lines[#lines + 1] = string.format(
      '    { "id": %s, "kind": %s, "path": %s, "hash": %s%s }%s',
      json_str(a.id),
      json_str(a.kind),
      json_str(a.path),
      json_str(a.hash),
      extra,
      comma
    )
  end
  lines[#lines + 1] = "  ]"
  return table.concat(lines, "\n")
end

--------------------------------------------------------------------------------
-- REAPER project
--------------------------------------------------------------------------------

local function strip_rpp(name)
  return trim(name):gsub("%.[Rr][Pp][Pp]$", "")
end

local function project_rpp_path()
  local a, b = reaper.EnumProjects(-1)
  if type(a) == "string" and a ~= "" and (not b or type(b) ~= "string") then
    return a
  end
  if type(b) == "string" then
    return b
  end
  return ""
end

local function project_title()
  local a, b = reaper.GetProjectName(0, "")
  local name = ""
  if type(a) == "string" and a ~= "" and type(b) ~= "string" then
    name = a
  elseif type(b) == "string" and b ~= "" then
    name = b
  elseif type(a) == "string" then
    name = a
  end
  name = strip_rpp(name)
  if name ~= "" then
    return name
  end
  local rpp = project_rpp_path()
  if rpp ~= "" then
    local base = rpp:match("([^\\/]+)$") or rpp
    return strip_rpp(base)
  end
  return "Untitled"
end

local function project_dir()
  local rpp = project_rpp_path()
  if rpp ~= "" then
    local dir = rpp:match("^(.*)[\\/][^\\/]+$")
    if dir and dir ~= "" then
      return dir
    end
  end
  local path = reaper.GetProjectPath("")
  if type(path) == "string" and path ~= "" then
    return path
  end
  local a, b = reaper.GetProjectPath(0, "")
  if type(b) == "string" and b ~= "" then
    return b
  end
  if type(a) == "string" and a ~= "" then
    return a
  end
  return ""
end

local function join_path(a, b)
  a = a:gsub("[\\/]+$", "")
  return a .. "/" .. b
end

local function shell_quote(s)
  return "'" .. tostring(s):gsub("'", "'\\''") .. "'"
end

local function powershell_quote(s)
  return "'" .. tostring(s):gsub("'", "''") .. "'"
end

local function is_absolute_path(p)
  p = trim(p or "")
  if p == "" or p:match("^%-?%d+$") then
    return false
  end
  if p:sub(1, 1) == "/" then
    return true
  end
  if p:match("^%a:[/\\]") or p:match("^\\\\") then
    return true
  end
  return false
end

-- Reaper ExecProcess: timeout 0 = wait forever. -1 means do not wait (returns a code like -3).
-- Return value is "exitcode\\nstdout" (or just the exit code).
local function run_cmd(cmd)
  if reaper.ExecProcess then
    local a, b = reaper.ExecProcess(cmd, 0)
    local exit_code, output
    if type(a) == "number" and type(b) == "string" then
      exit_code, output = a, trim(b)
    elseif type(a) == "string" then
      local first, rest = a:match("^([^\r\n]*)[\r\n]*(.*)$")
      exit_code = tonumber(first)
      output = trim(rest or "")
      if exit_code == nil and is_absolute_path(a) then
        output = trim(a)
        exit_code = 0
      end
    elseif type(a) == "number" then
      exit_code, output = a, ""
    else
      return nil, false, -1
    end
    if output:match("^%-?%d+$") and not output:match("[/\\]") then
      exit_code = tonumber(output) or exit_code
      output = ""
    end
    return output, true, exit_code or 0
  end
  local handle = io.popen(cmd)
  if not handle then
    return nil, false, -1
  end
  local out = handle:read("*a") or ""
  handle:close()
  return trim(out), true, 0
end

local function dir_exists(path)
  path = trim(path or ""):gsub("[\\/]+$", "")
  if path == "" then
    return false
  end
  local dot = io.open(path .. "/.", "r")
  if dot then
    dot:close()
    return true
  end
  local out = select(1, run_cmd("/bin/test -d " .. shell_quote(path) .. " && printf yes"))
  return out == "yes"
end

local function default_export_dir(title)
  title = trim(title or "")
  if title ~= "" and title ~= "Untitled" then
    local titled = join_path(LIBRARY_SONGS, title)
    if dir_exists(titled) then
      return titled
    end
  end
  return LIBRARY_SONGS
end

local function write_temp(suffix, body)
  local dir = reaper.GetResourcePath()
  if not dir or dir == "" then
    dir = os.getenv("TMPDIR") or os.getenv("TEMP") or "/tmp"
  end
  local tmp = join_path(dir, "dbk_stage_control_tmp" .. suffix)
  local file = io.open(tmp, "wb")
  if not file then
    return nil
  end
  file:write(body)
  file:close()
  return tmp
end

local function browse_prompt(prompt, start_dir)
  local retval, path = reaper.GetUserInputs("DBK Stage Control Export", 1, prompt .. ":extrawidth=420", start_dir or "")
  if not retval then
    return nil, true
  end
  path = trim(path)
  if path == "" then
    return nil, true
  end
  return path, false
end

local function browse_mac(prompt, start_dir)
  local prompt_esc = prompt:gsub("\\", "\\\\"):gsub('"', '\\"')
  local function ask(apple)
    return run_cmd("/usr/bin/osascript -e " .. shell_quote(apple))
  end

  local apple
  if is_absolute_path(start_dir) then
    local dir_esc = start_dir:gsub("\\", "\\\\"):gsub('"', '\\"')
    apple = string.format(
      'tell application "SystemUIServer" to POSIX path of (choose folder with prompt "%s" default location (POSIX file "%s"))',
      prompt_esc,
      dir_esc
    )
  else
    apple = string.format(
      'tell application "SystemUIServer" to POSIX path of (choose folder with prompt "%s")',
      prompt_esc
    )
  end

  local out, started, code = ask(apple)
  if is_absolute_path(out) then
    return out, false
  end
  if is_absolute_path(start_dir) then
    apple = string.format(
      'tell application "SystemUIServer" to POSIX path of (choose folder with prompt "%s")',
      prompt_esc
    )
    out, started, code = ask(apple)
    if is_absolute_path(out) then
      return out, false
    end
  end
  if not started then
    return nil, false
  end
  if code ~= 0 then
    return nil, true
  end
  return nil, false
end

local function browse_win(prompt, start_dir)
  local ps = {
    "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$d.Description = " .. powershell_quote(prompt),
    "$d.ShowNewFolderButton = $true"
  }
  if start_dir ~= "" then
    ps[#ps + 1] = "$d.SelectedPath = " .. powershell_quote(start_dir)
  end
  ps[#ps + 1] = "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }"
  local tmp = write_temp(".ps1", table.concat(ps, "\r\n"))
  if not tmp then
    return nil, false
  end
  local out, started, code = run_cmd(
    "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File " .. shell_quote(tmp)
  )
  os.remove(tmp)
  if not started then
    return nil, false
  end
  if out == "" then
    -- empty + success-ish usually means the user cancelled the dialog
    if code == 0 then
      return nil, true
    end
    return nil, false
  end
  return out, false
end

local function browse_linux(prompt, start_dir)
  local zenity = "zenity --file-selection --directory --title=" .. shell_quote(prompt)
  if start_dir ~= "" then
    zenity = zenity .. " --filename=" .. shell_quote(start_dir .. "/")
  end
  local out, started, code = run_cmd(zenity)
  if started and out ~= "" then
    return out, false
  end
  if started and (code == 1 or out == "") then
    return nil, true
  end
  local kdialog = "kdialog --getexistingdirectory "
    .. shell_quote(start_dir ~= "" and start_dir or ".")
    .. " "
    .. shell_quote(prompt)
  out, started, code = run_cmd(kdialog)
  if started and out ~= "" then
    return out, false
  end
  if started then
    return nil, true
  end
  return nil, false
end

local function browse_js_save(start_dir)
  if not reaper.JS_Dialog_BrowseForSaveFile then
    return nil, false
  end
  local ok, file = reaper.JS_Dialog_BrowseForSaveFile(
    "DBK Stage Control Export",
    start_dir,
    "song.json",
    "JSON files\0*.json\0All files\0*.*\0\0"
  )
  if not ok or not file or file == "" then
    return nil, true
  end
  local dir = file:match("^(.*)[\\/][^\\/]+$")
  return dir or file, false
end

-- Returns path, cancelled. cancelled=true means the user dismissed the dialog.
local function browse_for_folder(prompt, start_dir)
  start_dir = trim(start_dir or "")
  if not is_absolute_path(start_dir) then
    start_dir = ""
  end
  local osname = reaper.GetOS()
  local path, cancelled

  if osname:match("Win") then
    path, cancelled = browse_win(prompt, start_dir)
  elseif osname:match("OSX") or osname:match("macOS") then
    path, cancelled = browse_mac(prompt, start_dir)
  else
    path, cancelled = browse_linux(prompt, start_dir)
  end

  if path and is_absolute_path(path) then
    return path:gsub("[\\/]+$", ""), false
  end
  if cancelled then
    return nil, true
  end

  path, cancelled = browse_js_save(start_dir)
  if path and is_absolute_path(path) then
    return path:gsub("[\\/]+$", ""), false
  end
  if cancelled then
    return nil, true
  end

  local typed, typed_cancel = browse_prompt("Folder path", start_dir)
  if typed_cancel then
    return nil, true
  end
  if typed and is_absolute_path(typed) then
    return typed:gsub("[\\/]+$", ""), false
  end
  return nil, false
end

local function song_id(title, rpp)
  local base = ""
  if rpp and rpp ~= "" then
    base = rpp:match("([^\\/]+)%.[Rr][Pp][Pp]$") or ""
  end
  if base == "" then
    base = title
  end
  local slug = base:lower():gsub("[^%w]+", "_"):gsub("^_+", ""):gsub("_+$", "")
  if slug == "" then
    slug = "song"
  end
  return slug
end

local function musical_at(time)
  local _, measures, cml, fullbeats = reaper.TimeMap2_timeToBeats(0, time)
  measures = measures or 0
  cml = cml or 4
  fullbeats = fullbeats or 0
  local measure = math.floor(measures) + 1
  local beat_in = 1
  if cml > 0 then
    local pos = fullbeats - measures * cml
    if pos < 0 then
      pos = 0
    end
    beat_in = math.floor(pos) + 1
  end
  return measure, beat_in
end

local EVENT_BARLINE_SNAP_SEC = 0.05

local function nearest_barline(time)
  local _, measures = reaper.TimeMap2_timeToBeats(0, time)
  measures = math.floor((measures or 0) + 1e-9)
  local this_bar = reaper.TimeMap2_beatsToTime(0, 0, measures)
  local next_bar = reaper.TimeMap2_beatsToTime(0, 0, measures + 1)
  this_bar = this_bar or time
  next_bar = next_bar or this_bar
  if math.abs(next_bar - time) < math.abs(this_bar - time) then
    return next_bar
  end
  return this_bar
end

local function snap_to_barline(time, always)
  local bar = nearest_barline(time)
  if always or math.abs(bar - time) <= EVENT_BARLINE_SNAP_SEC then
    return round(bar, 6)
  end
  return round(time, 6)
end

local function collect_tempo_map()
  local map = {}
  local count = reaper.CountTempoTimeSigMarkers(0)
  local function point_at(time)
    local num, den, tempo = reaper.TimeMap_GetTimeSigAtTime(0, time)
    local measure = musical_at(time)
    return {
      time = round(time, 6),
      measure = measure,
      bpm = round(tempo or 120, 4),
      numerator = num and num > 0 and num or 4,
      denominator = den and den > 0 and den or 4
    }
  end

  if count == 0 then
    map[1] = point_at(0)
    return map
  end

  local last_num, last_den, last_bpm = 4, 4, 120
  local n0, d0, t0 = reaper.TimeMap_GetTimeSigAtTime(0, 0)
  if n0 and n0 > 0 then
    last_num = n0
  end
  if d0 and d0 > 0 then
    last_den = d0
  end
  if t0 and t0 ~= 0 then
    last_bpm = t0
  end

  for i = 0, count - 1 do
    local ok, timepos, _, _, bpm, timesig_num, timesig_denom = reaper.GetTempoTimeSigMarker(0, i)
    if ok ~= false and timepos ~= nil then
      if timesig_num and timesig_num > 0 then
        last_num = timesig_num
      end
      if timesig_denom and timesig_denom > 0 then
        last_den = timesig_denom
      end
      if bpm and bpm ~= 0 then
        last_bpm = bpm
      end
      local measure = musical_at(timepos)
      map[#map + 1] = {
        time = round(timepos, 6),
        measure = measure,
        bpm = round(last_bpm, 4),
        numerator = last_num,
        denominator = last_den
      }
    end
  end

  if #map == 0 then
    map[1] = point_at(0)
  elseif map[1].time > 0.0005 then
    table.insert(map, 1, point_at(0))
  end
  return map
end

local function fold_track_name(name)
  name = trim(name or "")
  name = name:gsub("\196\177", "I"):gsub("\196\176", "I") -- ı / İ
  return name:upper()
end

local function track_matches(name, keyword)
  local n = fold_track_name(name)
  local k = fold_track_name(keyword)
  if n == k then
    return true
  end
  if n:sub(1, #k) ~= k then
    return false
  end
  local nextc = n:sub(#k + 1, #k + 1)
  return nextc == " " or nextc == "_" or nextc == "-"
end

local function each_project_marker(fn)
  local a, b, c = reaper.CountProjectMarkers(0)
  local markers, regions
  if type(c) == "number" then
    markers, regions = b, c
  else
    markers, regions = a, b
  end
  local total = (tonumber(markers) or 0) + (tonumber(regions) or 0)
  for i = 0, total - 1 do
    local ret, isrgn, pos, rgnend, name
    if reaper.EnumProjectMarkers3 then
      ret, isrgn, pos, rgnend, name = reaper.EnumProjectMarkers3(0, i)
    elseif reaper.EnumProjectMarkers2 then
      ret, isrgn, pos, rgnend, name = reaper.EnumProjectMarkers2(0, i)
    else
      ret, isrgn, pos, rgnend, name = reaper.EnumProjectMarkers(i)
    end
    local ok = ret ~= false and ret ~= nil and ret ~= 0
    if ok then
      fn({
        is_region = isrgn == true or isrgn == 1,
        pos = pos,
        rgnend = rgnend,
        name = name or ""
      })
    end
  end
end

local function is_end_marker_name(name)
  local n = fold_track_name(name)
  return n == "END" or n == "=END" or n == "PROJECT END" or n == "PROJEND" or n == "SONG END" or n == "FIN"
end

local function last_media_item_end()
  local max_end = 0
  for t = 0, reaper.CountTracks(0) - 1 do
    local track = reaper.GetTrack(0, t)
    for i = 0, reaper.CountTrackMediaItems(track) - 1 do
      local item = reaper.GetTrackMediaItem(track, i)
      local pos = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
      local item_len = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
      local finish = pos + item_len
      if finish > max_end then
        max_end = finish
      end
    end
  end
  return max_end
end

local function content_length()
  local len = reaper.GetProjectLength(0) or 0
  if len > 0 then
    return len
  end
  return last_media_item_end()
end

local function last_region_end()
  local last = 0
  each_project_marker(function(mark)
    if mark.is_region and type(mark.rgnend) == "number" and mark.rgnend > last then
      last = mark.rgnend
    end
  end)
  return last
end

-- PROJECT_LENGTH is 0 unless "Limit project length" is on. The ruler
-- still stores MAXPROJLEN in the .rpp, including when the limit is off.
local function parse_rpp_maxprojlen()
  local path = project_rpp_path()
  if not path or path == "" then
    return nil, nil
  end
  local f = io.open(path, "r")
  if not f then
    return nil, nil
  end
  local limited, length
  for _ = 1, 500 do
    local line = f:read("*l")
    if not line then
      break
    end
    local flag, secs = line:match("^%s*MAXPROJLEN%s+(%d+)%s+([%-%+]?[%d%.eE]+)")
    if flag then
      limited = tonumber(flag) == 1
      length = tonumber(secs)
      break
    end
  end
  f:close()
  return limited, length
end

local function project_end_from_ruler()
  local plen = reaper.GetSetProjectInfo(0, "PROJECT_LENGTH", 0, false) or 0
  if plen <= 0.0005 then
    plen = reaper.GetSetProjectInfo(0, "PROJ_LENGTH", 0, false) or 0
  end
  local limited, rpp_len = parse_rpp_maxprojlen()
  if plen <= 0.0005 and rpp_len and rpp_len > 0.0005 and limited then
    plen = rpp_len
  end
  if plen > 0.0005 then
    return plen
  end
  -- Limit off, but the user dragged the project-end before leftover content.
  -- Ignore the unused factory default of 10:00.
  if rpp_len and rpp_len > 0.0005 and math.abs(rpp_len - 600) > 0.05 then
    local content = content_length()
    if content > rpp_len + 0.02 then
      return rpp_len
    end
  end
  return nil
end

local function project_duration()
  local named_end
  local last_marker
  each_project_marker(function(mark)
    if mark.is_region or type(mark.pos) ~= "number" then
      return
    end
    if is_end_marker_name(mark.name) then
      if not named_end or mark.pos < named_end then
        named_end = mark.pos
      end
    end
    if fold_track_name(mark.name) ~= "NEXT" then
      if not last_marker or mark.pos > last_marker then
        last_marker = mark.pos
      end
    end
  end)
  if named_end and named_end > 0 then
    return round(named_end, 6)
  end
  local ruler = project_end_from_ruler()
  if ruler then
    return round(ruler, 6)
  end
  local content = content_length()
  -- Leftover items/regions after the last project marker must not stretch
  -- the song. Do not grow duration to meet leftover section items.
  if last_marker and last_marker > 0 then
    local leftover = last_media_item_end() > last_marker + 0.02
      or last_region_end() > last_marker + 0.02
      or content > last_marker + 0.02
    if leftover then
      return round(last_marker, 6)
    end
  end
  if content > 0 then
    return round(content, 6)
  end
  return 0
end

-- Stem/click tracks: exact ALL-CAPS name only. "Drums" / "string" must not match.
local function track_named_exact(name, keyword)
  return trim(name or "") == keyword
end

local function collect_next_marker()
  local found
  each_project_marker(function(mark)
    if mark.is_region or type(mark.pos) ~= "number" then
      return
    end
    if fold_track_name(mark.name) == "NEXT" then
      if not found or mark.pos < found then
        found = mark.pos
      end
    end
  end)
  if found then
    return round(found, 6)
  end
  return nil
end

local function item_text(item)
  local notes = ""
  if reaper.ULT_GetMediaItemNote then
    notes = trim(reaper.ULT_GetMediaItemNote(item) or "")
  end
  if notes ~= "" then
    return notes
  end
  local take = reaper.GetActiveTake(item)
  if take then
    local ok, name = reaper.GetSetMediaItemTakeInfo_String(take, "P_NAME", "", false)
    if ok and name then
      name = trim(name)
      local upper = name:upper()
      if name ~= "" and upper ~= "MIDI" and upper ~= "AUDIO" then
        return name
      end
    end
  end
  return ""
end

local function collect_named_items(keyword)
  local found_track = false
  local items = {}
  for t = 0, reaper.CountTracks(0) - 1 do
    local track = reaper.GetTrack(0, t)
    local _, name = reaper.GetSetMediaTrackInfo_String(track, "P_NAME", "", false)
    if track_matches(name or "", keyword) then
      found_track = true
      for i = 0, reaper.CountTrackMediaItems(track) - 1 do
        local item = reaper.GetTrackMediaItem(track, i)
        local text = item_text(item)
        if text ~= "" then
          local pos = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
          local len = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
          local always_snap = keyword:upper() == "SECTION"
          local start = snap_to_barline(pos, always_snap)
          local finish = snap_to_barline(pos + len, always_snap)
          local measure, beat = musical_at(start)
          items[#items + 1] = {
            time = start,
            finish = finish,
            measure = measure,
            beat = beat,
            text = text
          }
        end
      end
    end
  end
  table.sort(items, function(a, b)
    if a.time == b.time then
      return a.finish < b.finish
    end
    return a.time < b.time
  end)
  return found_track, items
end

local function timesig_at(time)
  local num, den = reaper.TimeMap_GetTimeSigAtTime(0, time)
  if not num or num <= 0 then
    num = 4
  end
  if not den or den <= 0 then
    den = 4
  end
  return num, den
end

local function midi_notes_from_item(item)
  local notes = {}
  local ntakes = 0
  if reaper.GetMediaItemNumTakes then
    ntakes = reaper.GetMediaItemNumTakes(item) or 0
  elseif reaper.CountTakes then
    ntakes = reaper.CountTakes(item) or 0
  end
  for ti = 0, ntakes - 1 do
    local take = reaper.GetMediaItemTake(item, ti)
    if not take and reaper.GetTake then
      take = reaper.GetTake(item, ti)
    end
    if take and reaper.TakeIsMIDI(take) then
      if reaper.MIDI_Sort then
        reaper.MIDI_Sort(take)
      end
      local a, b = reaper.MIDI_CountEvts(take)
      local notecnt = 0
      if type(b) == "number" then
        notecnt = b
      elseif type(a) == "number" then
        notecnt = a
      end
      for n = 0, notecnt - 1 do
        local ok, selected, muted, startppq, endppq, chan, pitch, vel = reaper.MIDI_GetNote(take, n)
        local skip = muted == true or muted == 1
        if ok ~= false and not skip and startppq then
          local t0 = reaper.MIDI_GetProjTimeFromPPQPos(take, startppq)
          local t1 = endppq and reaper.MIDI_GetProjTimeFromPPQPos(take, endppq) or t0
          local measure, beat = musical_at(t0)
          local num, den = timesig_at(t0)
          notes[#notes + 1] = {
            time = round(t0, 6),
            finish = round(t1, 6),
            pitch = pitch or 0,
            channel = chan or 0,
            velocity = vel or 0,
            measure = measure,
            beat = beat,
            numerator = num,
            denominator = den
          }
        end
      end
    end
  end
  table.sort(notes, function(a, b)
    if a.time == b.time then
      return (a.pitch or 0) < (b.pitch or 0)
    end
    return a.time < b.time
  end)
  return notes
end

local function collect_patterns()
  local found_track = false
  local items = {}
  for t = 0, reaper.CountTracks(0) - 1 do
    local track = reaper.GetTrack(0, t)
    local _, name = reaper.GetSetMediaTrackInfo_String(track, "P_NAME", "", false)
    if track_matches(name or "", "PATTERN") then
      found_track = true
      for i = 0, reaper.CountTrackMediaItems(track) - 1 do
        local item = reaper.GetTrackMediaItem(track, i)
        local text = item_text(item)
        local notes = midi_notes_from_item(item)
        if text ~= "" or #notes > 0 then
          local pos = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
          local len = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
          local start = snap_to_barline(pos, false)
          local finish = snap_to_barline(pos + len, false)
          local measure, beat = musical_at(start)
          local num, den = timesig_at(start)
          items[#items + 1] = {
            text = text,
            time = start,
            finish = finish,
            length = round(finish - start, 6),
            measure = measure,
            beat = beat,
            numerator = num,
            denominator = den,
            notes = notes
          }
        end
      end
    end
  end
  table.sort(items, function(a, b)
    if a.time == b.time then
      return a.finish < b.finish
    end
    return a.time < b.time
  end)
  return found_track, items
end

local function collect_chords()
  local found_track = false
  local items = {}
  for t = 0, reaper.CountTracks(0) - 1 do
    local track = reaper.GetTrack(0, t)
    local _, name = reaper.GetSetMediaTrackInfo_String(track, "P_NAME", "", false)
    if track_matches(name or "", "CHORDS") then
      found_track = true
      for i = 0, reaper.CountTrackMediaItems(track) - 1 do
        local item = reaper.GetTrackMediaItem(track, i)
        local text = item_text(item)
        local notes = midi_notes_from_item(item)
        if text ~= "" or #notes > 0 then
          local pos = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
          local len = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
          local start = snap_to_barline(pos, false)
          local finish = snap_to_barline(pos + len, false)
          local measure, beat = musical_at(start)
          items[#items + 1] = {
            time = start,
            finish = finish,
            measure = measure,
            beat = beat,
            text = text,
            notes = notes
          }
        end
      end
    end
  end
  table.sort(items, function(a, b)
    if a.time == b.time then
      return a.finish < b.finish
    end
    return a.time < b.time
  end)
  return found_track, items
end

local function find_named_tracks(keyword)
  local tracks = {}
  for t = 0, reaper.CountTracks(0) - 1 do
    local track = reaper.GetTrack(0, t)
    local _, name = reaper.GetSetMediaTrackInfo_String(track, "P_NAME", "", false)
    if track_named_exact(name or "", keyword) then
      tracks[#tracks + 1] = track
    end
  end
  return tracks
end

local function collect_click()
  local tracks = find_named_tracks("CLICK")
  return {
    found = #tracks > 0,
    count = #tracks,
    tracks = tracks,
    duration = project_duration(),
    warning = #tracks == 0 and "CLICK track not found" or nil
  }
end

local function collect_stems()
  local stems = {}
  for _, spec in ipairs(STEM_SPECS) do
    local tracks = find_named_tracks(spec.key)
    stems[#stems + 1] = {
      key = spec.key,
      file = spec.file,
      tracks = tracks,
      count = #tracks,
      found = #tracks > 0
    }
  end
  return stems
end

local function clip_timed(items, ending)
  if not ending or ending <= 0 or not items then
    return items or {}
  end
  local out = {}
  for _, item in ipairs(items) do
    local start = item.time or item.start or 0
    if start < ending - 0.0005 then
      local copy = {}
      for k, v in pairs(item) do
        copy[k] = v
      end
      if copy.finish and copy.finish > ending then
        copy.finish = ending
      end
      if copy["end"] and copy["end"] > ending then
        copy["end"] = ending
      end
      out[#out + 1] = copy
    end
  end
  return out
end

local function collect_project()
  local title = project_title()
  local rpp = project_rpp_path()
  local duration = project_duration()
  local section_found, section_items = collect_named_items("SECTION")
  local lyrics_found, lyrics_items = collect_named_items("LYRICS")
  local chords_found, chords_items = collect_chords()
  local pattern_found, pattern_items = collect_patterns()
  section_items = clip_timed(section_items, duration)
  lyrics_items = clip_timed(lyrics_items, duration)
  chords_items = clip_timed(chords_items, duration)
  pattern_items = clip_timed(pattern_items, duration)
  local click = collect_click()
  local stems = collect_stems()
  local sections = {}
  for _, item in ipairs(section_items) do
    sections[#sections + 1] = {
      name = item.text,
      start = item.time,
      ["end"] = item.finish
    }
  end
  return {
    id = song_id(title, rpp),
    title = title,
    duration = duration,
    tempoMap = collect_tempo_map(),
    nextSongAt = collect_next_marker(),
    sections = sections,
    lyrics = lyrics_items,
    chords = chords_items,
    patterns = pattern_items,
    click = click,
    stems = stems,
    clickDuration = click.found and round(click.duration, 6) or nil,
    flags = {
      section_found = section_found,
      lyrics_found = lyrics_found,
      chords_found = chords_found,
      pattern_found = pattern_found
    },
    dir = project_dir(),
    rpp = rpp
  }
end

--------------------------------------------------------------------------------
-- Export
--------------------------------------------------------------------------------

local function read_text(path)
  local file = io.open(path, "r")
  if not file then
    return nil
  end
  local body = file:read("*a")
  file:close()
  if type(body) == "string" and body ~= "" then
    return body
  end
  return nil
end

local function extract_json_array(body, key)
  if not body or body == "" then
    return nil
  end
  local start = body:find('"' .. key .. '"%s*:', 1)
  if not start then
    return nil
  end
  local i = body:find("%[", start)
  if not i then
    return nil
  end
  local depth, in_str, esc = 0, false, false
  for pos = i, #body do
    local c = body:sub(pos, pos)
    if in_str then
      if esc then
        esc = false
      elseif c == "\\" then
        esc = true
      elseif c == '"' then
        in_str = false
      end
    elseif c == '"' then
      in_str = true
    elseif c == "[" then
      depth = depth + 1
    elseif c == "]" then
      depth = depth - 1
      if depth == 0 then
        return body:sub(i, pos)
      end
    end
  end
  return nil
end

local function keep_json_array(existing, key, encoded)
  if encoded and encoded ~= "[]" then
    return encoded
  end
  return (existing and extract_json_array(existing, key)) or encoded or "[]"
end

local function extract_json_object(body, key)
  if not body or body == "" then
    return nil
  end
  local start = body:find('"' .. key .. '"%s*:', 1)
  if not start then
    return nil
  end
  local i = body:find("{", start)
  if not i then
    return nil
  end
  local depth, in_str, esc = 0, false, false
  for pos = i, #body do
    local c = body:sub(pos, pos)
    if in_str then
      if esc then
        esc = false
      elseif c == "\\" then
        esc = true
      elseif c == '"' then
        in_str = false
      end
    elseif c == '"' then
      in_str = true
    elseif c == "{" then
      depth = depth + 1
    elseif c == "}" then
      depth = depth - 1
      if depth == 0 then
        return body:sub(i, pos)
      end
    end
  end
  return nil
end

local function with_kita_in_info(info_json, kita)
  if kita == nil then
    return info_json
  end
  local kita_json = json_num(kita)
  if info_json then
    if info_json:find('"kita"') then
      return (info_json:gsub('"kita"%s*:%s*-?[0-9]+', '"kita": ' .. kita_json, 1))
    end
    return (info_json:gsub("}[%s]*$", ',\n    "kita": ' .. kita_json .. "\n  }"))
  end
  return '{\n    "kita": ' .. kita_json .. "\n  }"
end

local function write_file(path, body)
  local file, err = io.open(path, "wb")
  if not file then
    return false, err or "could not open file"
  end
  file:write(body)
  file:write("\n")
  file:close()
  return true
end

local function base64_encode(data)
  local alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  local out = {}
  local n = #data
  for i = 1, n, 3 do
    local a, b, c = data:byte(i, i + 2)
    b = b or 0
    c = c or 0
    local triple = a * 65536 + b * 256 + c
    local nchars = 2
    if i + 1 <= n then
      nchars = 3
    end
    if i + 2 <= n then
      nchars = 4
    end
    local chunk = alphabet:sub(math.floor(triple / 262144) % 64 + 1, math.floor(triple / 262144) % 64 + 1)
      .. alphabet:sub(math.floor(triple / 4096) % 64 + 1, math.floor(triple / 4096) % 64 + 1)
      .. alphabet:sub(math.floor(triple / 64) % 64 + 1, math.floor(triple / 64) % 64 + 1)
      .. alphabet:sub(triple % 64 + 1, triple % 64 + 1)
    if nchars == 2 then
      chunk = chunk:sub(1, 2) .. "=="
    elseif nchars == 3 then
      chunk = chunk:sub(1, 3) .. "="
    end
    out[#out + 1] = chunk
  end
  return table.concat(out)
end

local function pack_u32(n)
  n = math.floor(tonumber(n) or 0)
  local a = n % 256
  n = math.floor(n / 256)
  local b = n % 256
  n = math.floor(n / 256)
  local c = n % 256
  n = math.floor(n / 256)
  return string.char(a, b, c, n % 256)
end

-- FLAC, 16-bit, compression 5 (Reaper RENDER_FORMAT base64).
local FLAC16_CFG = base64_encode("calf" .. string.char(16, 0, 0, 0, 5, 0, 0, 0))

-- MP3 CBR 128 kbps, joint stereo, Normal quality (l3pm sink).
local MP3_128_CFG = base64_encode(
  "l3pm" .. pack_u32(128) .. pack_u32(0) .. pack_u32(3) .. string.char(255, 255, 255, 255) .. pack_u32(4) .. pack_u32(128) .. pack_u32(0)
)

local function snapshot_selection()
  local items = {}
  for i = 0, reaper.CountSelectedMediaItems(0) - 1 do
    items[#items + 1] = reaper.GetSelectedMediaItem(0, i)
  end
  local tracks = {}
  for i = 0, reaper.CountSelectedTracks(0) - 1 do
    tracks[#tracks + 1] = reaper.GetSelectedTrack(0, i)
  end
  return items, tracks
end

local function restore_selection(items, tracks)
  reaper.Main_OnCommand(40289, 0) -- Item: Unselect all
  reaper.Main_OnCommand(40297, 0) -- Track: Unselect all tracks
  for _, item in ipairs(items) do
    if item then
      reaper.SetMediaItemSelected(item, true)
    end
  end
  for _, track in ipairs(tracks) do
    if track then
      reaper.SetTrackSelected(track, true)
    end
  end
end

local function snapshot_track_flags()
  local flags = {}
  for t = 0, reaper.CountTracks(0) - 1 do
    local track = reaper.GetTrack(0, t)
    flags[#flags + 1] = {
      track = track,
      mute = reaper.GetMediaTrackInfo_Value(track, "B_MUTE"),
      solo = reaper.GetMediaTrackInfo_Value(track, "I_SOLO")
    }
  end
  return flags
end

local function restore_track_flags(flags)
  for _, f in ipairs(flags) do
    if f.track then
      reaper.SetMediaTrackInfo_Value(f.track, "B_MUTE", f.mute)
      reaper.SetMediaTrackInfo_Value(f.track, "I_SOLO", f.solo)
    end
  end
end

local function walk_track_and_children(track, apply)
  local idx = math.floor(reaper.GetMediaTrackInfo_Value(track, "IP_TRACKNUMBER") + 0.5) - 1
  if idx < 0 then
    return
  end
  apply(track)
  local nest = reaper.GetMediaTrackInfo_Value(track, "I_FOLDERDEPTH")
  if nest <= 0 then
    return
  end
  for t = idx + 1, reaper.CountTracks(0) - 1 do
    local child = reaper.GetTrack(0, t)
    apply(child)
    nest = nest + reaper.GetMediaTrackInfo_Value(child, "I_FOLDERDEPTH")
    if nest <= 0 then
      break
    end
  end
end

-- 0 = Master mix (stem soloed, then printed through the master bus as one file).
local RENDER_MASTER_MIX = 0

local function solo_track_and_children(track)
  walk_track_and_children(track, function(t)
    reaper.SetMediaTrackInfo_Value(t, "I_SOLO", 1)
    reaper.SetMediaTrackInfo_Value(t, "B_MUTE", 0)
  end)
end

local function select_only_tracks(tracks)
  reaper.Main_OnCommand(40297, 0) -- Track: Unselect all tracks
  for _, track in ipairs(tracks or {}) do
    if track then
      reaper.SetTrackSelected(track, true)
    end
  end
end

local function mute_track_and_children(track)
  walk_track_and_children(track, function(t)
    reaper.SetMediaTrackInfo_Value(t, "B_MUTE", 1)
    reaper.SetMediaTrackInfo_Value(t, "I_SOLO", 0)
  end)
end

local function remove_increment_renders(out_dir, file, ext)
  for n = 1, 99 do
    local extra = join_path(out_dir, string.format("%s-%03d.%s", file, n, ext))
    if reaper.file_exists(extra) then
      os.remove(extra)
    else
      break
    end
  end
end

local function render_bounce(opts)
  local dest = join_path(opts.out_dir, opts.file .. "." .. opts.ext)
  if reaper.file_exists(dest) then
    os.remove(dest)
  end
  remove_increment_renders(opts.out_dir, opts.file, opts.ext)
  for _, extra in ipairs(opts.remove or {}) do
    local old = join_path(opts.out_dir, extra)
    if old ~= dest and reaper.file_exists(old) then
      os.remove(old)
    end
  end

  local restores = {}
  local function set_num(key, value)
    local old = reaper.GetSetProjectInfo(0, key, 0, false)
    reaper.GetSetProjectInfo(0, key, value, true)
    restores[#restores + 1] = function()
      reaper.GetSetProjectInfo(0, key, old, true)
    end
  end
  local function set_str(key, value)
    local _, old = reaper.GetSetProjectInfo_String(0, key, "", false)
    reaper.GetSetProjectInfo_String(0, key, value, true)
    restores[#restores + 1] = function()
      reaper.GetSetProjectInfo_String(0, key, old or "", true)
    end
  end

  local sel_items, sel_tracks = snapshot_selection()
  local flags = snapshot_track_flags()
  reaper.PreventUIRefresh(1)
  if opts.solo_tracks then
    reaper.Main_OnCommand(40340, 0) -- Track: Unsolo all tracks
    for _, track in ipairs(opts.solo_tracks) do
      solo_track_and_children(track)
    end
    -- Select only the named stem/click track. Via-master already includes
    -- folder children and receives; selecting children would write extra files.
    select_only_tracks(opts.solo_tracks)
  end
  for _, track in ipairs(opts.mute_tracks or {}) do
    mute_track_and_children(track)
  end

  set_str("RENDER_FILE", opts.out_dir)
  set_str("RENDER_PATTERN", opts.file)
  set_str("RENDER_FORMAT", opts.format)
  set_str("RENDER_FORMAT2", "")
  set_num("RENDER_SETTINGS", opts.source or RENDER_MASTER_MIX)
  set_num("RENDER_BOUNDSFLAG", 0)
  set_num("RENDER_STARTPOS", 0)
  set_num("RENDER_ENDPOS", project_duration())
  set_num("RENDER_SRATE", 44100)
  set_num("RENDER_CHANNELS", 2)
  set_num("RENDER_TAILFLAG", 0)
  set_num("RENDER_ADDTOPROJ", 0)
  set_num("RENDER_DITHER", 1)

  reaper.Main_OnCommand(42230, 0)

  for i = #restores, 1, -1 do
    restores[i]()
  end
  restore_track_flags(flags)
  restore_selection(sel_items, sel_tracks)
  reaper.PreventUIRefresh(-1)
  reaper.UpdateArrange()

  -- Via-master can still write Name-001.flac for folder children; keep one file.
  if reaper.file_exists(dest) then
    remove_increment_renders(opts.out_dir, opts.file, opts.ext)
    return true, dest
  end
  return false, "Render did not create " .. opts.file .. "." .. opts.ext
end

local function render_stem_flac(stem, out_dir)
  local remove = {}
  if stem.file == "Click" then
    remove[1] = "click.flac"
  end
  return render_bounce({
    out_dir = out_dir,
    file = stem.file,
    ext = "flac",
    format = FLAC16_CFG,
    -- One bounce through the master bus. "Selected tracks via master" writes
    -- a file per folder child (String-001, Drums-002, ...).
    source = RENDER_MASTER_MIX,
    solo_tracks = stem.tracks,
    remove = remove
  })
end

local function render_master_mp3(out_dir, click_tracks)
  local mute = {}
  for _, track in ipairs(click_tracks or {}) do
    mute[#mute + 1] = track
  end
  for _, track in ipairs(find_named_tracks("NOTA")) do
    mute[#mute + 1] = track
  end
  return render_bounce({
    out_dir = out_dir,
    file = "Master",
    ext = "mp3",
    format = MP3_128_CFG,
    source = RENDER_MASTER_MIX,
    mute_tracks = mute,
    remove = { "master.mp3", "Master.flac", "master.flac" }
  })
end

local function build_song_json(data, master_path, click_path, stem_files, opts)
  opts = opts or {}
  local key_str = opts.key or ""
  local scale_str = opts.scale or ""
  local style_str = opts.style or ""
  local kita = opts.kita
  local include = opts.include or {}
  local existing = opts.existing
  local assets = {}
  if master_path then
    assets[#assets + 1] = {
      id = "master",
      kind = "audio",
      path = "Master.mp3",
      hash = "sha256:pending",
      label = "Master"
    }
  end
  if click_path then
    assets[#assets + 1] = {
      id = "click",
      kind = "audio",
      audioRole = "click",
      bus = "CUE",
      path = "Click.flac",
      hash = "sha256:pending",
      label = "Click"
    }
  end
  for _, stem in ipairs(stem_files or {}) do
    assets[#assets + 1] = {
      id = stem.file:lower(),
      kind = "audio",
      audioRole = "stem",
      bus = "MAIN",
      path = stem.file .. ".flac",
      hash = "sha256:pending",
      label = stem.file
    }
  end

  local parts = {
    "{",
    '  "id": ' .. json_str(data.id) .. ",",
    '  "version": 1,',
    '  "title": ' .. json_str(data.title) .. ",",
    '  "duration": ' .. json_num(data.duration) .. ","
  }
  if click_path and data.clickDuration then
    parts[#parts + 1] = '  "clickDuration": ' .. json_num(data.clickDuration) .. ","
  end
  if include.NEXT ~= false and data.nextSongAt then
    parts[#parts + 1] = '  "nextSongAt": ' .. json_num(data.nextSongAt) .. ","
  end
  if include.KEY ~= false and key_str ~= "" then
    parts[#parts + 1] = '  "key": ' .. json_str(key_str) .. ","
  end
  if include.SCALE ~= false and scale_str ~= "" then
    parts[#parts + 1] = '  "scale": ' .. json_str(scale_str) .. ","
  end
  if include.STYLE ~= false and style_str ~= "" then
    parts[#parts + 1] = '  "style": ' .. json_str(style_str) .. ","
  end
  if include.KITA ~= false and kita ~= nil then
    parts[#parts + 1] = '  "kita": ' .. json_num(kita) .. ","
  end
  parts[#parts + 1] = '  "tags": ["reaper-export"],'
  parts[#parts + 1] = '  "tempoMap": ' .. encode_tempo_map(data.tempoMap) .. ","
  parts[#parts + 1] = '  "sections": ' .. keep_json_array(
    existing,
    "sections",
    encode_sections((include.SECTION ~= false) and data.sections or {})
  ) .. ","
  parts[#parts + 1] = '  "lyrics": ' .. keep_json_array(
    existing,
    "lyrics",
    encode_timed((include.LYRICS ~= false) and data.lyrics or {})
  ) .. ","
  parts[#parts + 1] = '  "chords": ' .. keep_json_array(
    existing,
    "chords",
    encode_chords((include.CHORDS ~= false) and data.chords or {})
  ) .. ","
  parts[#parts + 1] = '  "patterns": ' .. keep_json_array(
    existing,
    "patterns",
    encode_patterns((include.PATTERN ~= false) and (data.patterns or {}) or {})
  ) .. ","
  parts[#parts + 1] = '  "assets": ' .. keep_json_array(existing, "assets", encode_assets(assets))
  local existing_info = existing and extract_json_object(existing, "info")
  local info_json = existing_info
  if include.KITA ~= false then
    info_json = with_kita_in_info(existing_info, kita)
  end
  if info_json then
    parts[#parts] = parts[#parts] .. ","
    parts[#parts + 1] = '  "info": ' .. info_json
  end
  parts[#parts + 1] = "}"
  return table.concat(parts, "\n") .. "\n"
end

local function export_json(data, out_dir, opts)
  if not out_dir or out_dir == "" then
    return false, "No folder selected."
  end
  opts = opts or {}
  local include = opts.include or {}
  out_dir = out_dir:gsub("[\\/]+$", "")
  reaper.RecursiveCreateDirectory(out_dir, 0)

  local extras = {}
  local master_file
  if include.MASTER then
    local rendered, dest = render_master_mp3(out_dir, data.click and data.click.tracks or {})
    if rendered then
      master_file = "Master.mp3"
    else
      extras[#extras + 1] = dest or "MASTER render failed"
    end
  end

  local click_file
  local want_click = include.CLICK and data.click and data.click.found
  if include.CLICK and not want_click then
    extras[#extras + 1] = (data.click and data.click.warning) or "CLICK not found"
  end
  if want_click then
    local rendered, dest = render_stem_flac({
      file = "Click",
      tracks = data.click.tracks
    }, out_dir)
    if rendered then
      click_file = "Click.flac"
    else
      extras[#extras + 1] = dest or "CLICK render failed"
    end
  end

  local stem_files = {}
  for _, stem in ipairs(data.stems or {}) do
    if include[stem.key] then
      if stem.found then
        local rendered, dest = render_stem_flac(stem, out_dir)
        if rendered then
          stem_files[#stem_files + 1] = stem
        else
          extras[#extras + 1] = dest or (stem.file .. " render failed")
        end
      else
        extras[#extras + 1] = stem.key .. " not found"
      end
    end
  end

  local extra_note
  if #extras > 0 then
    extra_note = table.concat(extras, "  ·  ")
  end

  local song_path = join_path(out_dir, "song.json")
  opts.existing = read_text(song_path)
  local ok, err = write_file(
    song_path,
    build_song_json(data, master_file, click_file, stem_files, opts)
  )
  if not ok then
    return false, "Could not write song.json: " .. tostring(err)
  end

  local written = { "song.json" }
  if master_file then
    written[#written + 1] = master_file
  end
  if click_file then
    written[#written + 1] = click_file
  end
  for _, stem in ipairs(stem_files) do
    written[#written + 1] = stem.file .. ".flac"
  end
  return true, out_dir, written, extra_note
end

--------------------------------------------------------------------------------
-- UI state
--------------------------------------------------------------------------------

local function index_of(list, value, fallback)
  if value == nil then
    return fallback
  end
  for i, v in ipairs(list) do
    if v == value then
      return i
    end
  end
  return fallback
end

local function acc_label(v)
  if v == "#" then
    return "#"
  end
  if v == "b" then
    return "b"
  end
  return "–"
end

local function load_acc_index()
  local nat = index_of(KEY_ACC, "", 3)
  local saved = proj_get("key_acc") or ""
  if saved == "nat" or saved == "" then
    return nat
  end
  return index_of(KEY_ACC, saved, nat)
end

local function persist_acc(i)
  local v = KEY_ACC[i] or ""
  proj_set("key_acc", v == "" and "nat" or v)
end

local function kita_digit(raw)
  local s = tostring(raw or "0")
  if s:match("^%d$") then
    return s
  end
  return "0"
end

local state = {
  out_dir = "",
  path_override = false,
  last_title = nil,
  pending = nil,
  status = "",
  status_ok = true,
  data = collect_project(),
  include = {},
  open_combo = nil,
  kita_focus = false,
  tone_i = index_of(KEY_TONES, proj_get("key_tone") or KEY_EMPTY, 1),
  acc_i = 3,
  scale_i = index_of(KEY_SCALES, proj_get("key_scale") or KEY_EMPTY, 1),
  style_i = index_of(KEY_STYLES, proj_get("key_style") or KEY_EMPTY, 1),
  kita = kita_digit(proj_get("kita") or "0")
}
state.acc_i = load_acc_index()
state.out_dir = default_export_dir(state.data.title)
state.last_title = state.data.title

local mouse = {
  x = 0,
  y = 0,
  down = false,
  prev = false,
  click = false,
  consumed = false
}

local hit = {
  export_btn = nil,
  browse_btn = nil,
  combos = {},
  checks = {},
  kita = nil,
  menu = nil
}

local function mouse_in(x, y, w, h)
  return mouse.x >= x and mouse.x < x + w and mouse.y >= y and mouse.y < y + h
end

local function format_duration(sec)
  sec = sec or 0
  local m = math.floor(sec / 60)
  local s = sec - m * 60
  return string.format("%d:%05.2f", m, s)
end

local function tempo_summary(map)
  if #map == 0 then
    return "—"
  end
  local minb, maxb = map[1].bpm, map[1].bpm
  for _, p in ipairs(map) do
    if p.bpm < minb then
      minb = p.bpm
    end
    if p.bpm > maxb then
      maxb = p.bpm
    end
  end
  local bpm
  if minb == maxb then
    bpm = string.format("%g BPM", minb)
  else
    bpm = string.format("%g–%g BPM", minb, maxb)
  end
  return string.format("%s  ·  %d/%d", bpm, map[1].numerator, map[1].denominator)
end

local function draw_row(x, y, w, h, label, value)
  fill_rect(x, y, w, h, COL.panel)
  set_font(13)
  text_at(x + 12, y + 8, label, COL.muted)
  set_font(16)
  text_at(x + 12, y + 28, value, COL.text, x + w - 12, y + h - 6)
end

local function selected_key()
  local tone = KEY_TONES[state.tone_i] or KEY_EMPTY
  if is_blank_opt(tone) then
    return ""
  end
  return tone .. (KEY_ACC[state.acc_i] or "")
end

local function selected_opt(list, index)
  local v = list[index]
  if is_blank_opt(v) then
    return ""
  end
  return v
end

local function persist_project_settings()
  proj_set("key_tone", KEY_TONES[state.tone_i] or KEY_EMPTY)
  persist_acc(state.acc_i)
  proj_set("key_scale", KEY_SCALES[state.scale_i] or KEY_EMPTY)
  proj_set("key_style", KEY_STYLES[state.style_i] or KEY_EMPTY)
  proj_set("kita", kita_digit(state.kita))
  for key, on in pairs(state.include) do
    if key == "MASTER" or key == "CLICK" or STEM_KEYS[key] then
      proj_set("include_" .. key, on and "1" or "0")
    end
  end
end

local function click_exportable(click)
  return click and click.found
end

local function wants_include(key, exportable)
  if not exportable then
    return false
  end
  local v = state.include[key]
  if v == nil then
    local saved = proj_get("include_" .. key)
    if saved == "0" then
      state.include[key] = false
      return false
    end
    state.include[key] = true
    return true
  end
  return v and true or false
end

local function toggle_include(key, exportable)
  if not exportable then
    return
  end
  local on = not wants_include(key, true)
  state.include[key] = on
  persist_project_settings()
end

local function include_map(data)
  local m = {
    MASTER = wants_include("MASTER", true),
    CLICK = wants_include("CLICK", click_exportable(data.click)),
    KEY = true,
    SCALE = true,
    STYLE = true,
    KITA = true,
    SECTION = true,
    LYRICS = true,
    CHORDS = true,
    PATTERN = true,
    NEXT = true
  }
  for _, stem in ipairs(data.stems or {}) do
    m[stem.key] = wants_include(stem.key, stem.found)
  end
  return m
end

local function paths_equal(a, b)
  a = trim(a or ""):gsub("[\\/]+$", "")
  b = trim(b or ""):gsub("[\\/]+$", "")
  return a ~= "" and a == b
end

local function path_matches_default()
  return paths_equal(state.out_dir, default_export_dir(state.data and state.data.title or ""))
end

local function refresh_out_dir()
  if state.path_override then
    return
  end
  if state.data.title ~= state.last_title then
    state.last_title = state.data.title
  end
  state.out_dir = default_export_dir(state.data.title)
end

local function choose_export_folder()
  local start = is_absolute_path(state.out_dir) and state.out_dir or LIBRARY_SONGS
  local path, cancelled = browse_for_folder("Choose folder for DBK export files", start)
  if cancelled then
    return nil, true
  end
  if not is_absolute_path(path) then
    return nil, false
  end
  state.out_dir = path
  state.path_override = true
  reaper.SetExtState(EXT_NS, "export_dir", path, true)
  state.status_ok = true
  state.status = "Folder: " .. path
  return path, false
end

local function do_export()
  state.data = collect_project()
  refresh_out_dir()
  local out_dir = state.out_dir
  if not is_absolute_path(out_dir) then
    state.status_ok = false
    state.status = "No export folder."
    return
  end

  local ok, a, b, extra_note = export_json(state.data, out_dir, {
    key = selected_key(),
    scale = selected_opt(KEY_SCALES, state.scale_i),
    style = selected_opt(KEY_STYLES, state.style_i),
    kita = tonumber(kita_digit(state.kita)),
    include = include_map(state.data)
  })
  persist_project_settings()
  reaper.Main_SaveProject(0, false)
  if not ok then
    state.status_ok = false
    state.status = a
    return
  end
  local msg = "Saved " .. table.concat(b, ", ") .. " → " .. a
  if extra_note then
    state.status_ok = false
    state.status = msg .. "  ·  " .. extra_note
  else
    state.status_ok = true
    state.status = msg
  end
end

local function draw_combo(id, x, y, w, h, options, index, label_fn)
  fill_rect(x, y, w, h, COL.panel2)
  local open = state.open_combo == id
  stroke_rect(x, y, w, h, open and COL.accent or COL.border)
  local text = options[index] or ""
  if label_fn then
    text = label_fn(text)
  elseif is_blank_opt(text) then
    text = KEY_EMPTY
  end
  set_font(15)
  local _, th = gfx.measurestr(text ~= "" and text or "A")
  local ty = y + math.max(2, (h - th) / 2)
  text_at(x + 8, ty, text, COL.text, x + w - 22, y + h)
  setcol(COL.muted)
  local tx = x + w - 14
  local mid = y + h / 2
  gfx.triangle(tx - 5, mid - 3, tx + 5, mid - 3, tx, mid + 4)
  hit.combos[#hit.combos + 1] = {
    id = id,
    x = x,
    y = y,
    w = w,
    h = h,
    options = options,
    index = index,
    label_fn = label_fn
  }
end

local function draw_checkbox(x, y, size, on, enabled)
  local rgb = enabled and COL.border or { 58, 58, 64 }
  stroke_rect(x, y, size, size, rgb)
  if on and enabled then
    fill_rect(x + 3, y + 3, size - 6, size - 6, COL.accent)
  elseif on then
    fill_rect(x + 3, y + 3, size - 6, size - 6, COL.muted)
  end
end

local function draw_open_menu()
  if not state.open_combo then
    return
  end
  local combo
  for _, c in ipairs(hit.combos) do
    if c.id == state.open_combo then
      combo = c
      break
    end
  end
  if not combo then
    return
  end
  local item_h = 28
  local mh = item_h * #combo.options
  local my = combo.y + combo.h + 2
  if my + mh > gfx.h - 8 then
    my = combo.y - mh - 2
  end
  fill_rect(combo.x, my, combo.w, mh, COL.panel2)
  stroke_rect(combo.x, my, combo.w, mh, COL.accent)
  hit.menu = { id = combo.id, x = combo.x, y = my, w = combo.w, h = mh, items = {} }
  for i, opt in ipairs(combo.options) do
    local iy = my + (i - 1) * item_h
    if mouse_in(combo.x, iy, combo.w, item_h) then
      fill_rect(combo.x, iy, combo.w, item_h, COL.hover)
    elseif i == combo.index then
      fill_rect(combo.x, iy, combo.w, item_h, COL.accent_dim)
    end
    local label = opt
    if combo.label_fn then
      label = combo.label_fn(opt)
    elseif is_blank_opt(label) then
      label = KEY_EMPTY
    end
    set_font(15)
    text_at(combo.x + 8, iy + (item_h - 15) / 2, label, COL.text, combo.x + combo.w - 8, iy + item_h)
    hit.menu.items[i] = { i = i, x = combo.x, y = iy, w = combo.w, h = item_h }
  end
end

local function apply_combo_choice(id, i)
  if id == "tone" then
    state.tone_i = i
  elseif id == "acc" then
    state.acc_i = i
  elseif id == "scale" then
    state.scale_i = i
  elseif id == "style" then
    state.style_i = i
  end
  persist_project_settings()
end

local function draw_info_label(x, y, label)
  set_font(13)
  text_at(x, y, label, COL.muted)
end

local function draw()
  fill_rect(0, 0, gfx.w, gfx.h, COL.bg)

  local pad = 20
  local x = pad
  local y = 16
  local w = gfx.w - pad * 2

  set_font(22)
  text_at(x, y, "DBK Stage Control Export", COL.accent)
  y = y + 32

  local row_h = 56
  local gap = 10
  local half = (w - gap) / 2
  local ch = 30
  local combo_w = math.floor((half - 24) * 0.68)
  local kita_w = math.floor((half - 24) / 2)
  local tone_w, acc_w = 56, 48

  draw_row(x, y, half, row_h, "DURATION", format_duration(state.data.duration))
  fill_rect(x + half + gap, y, half, row_h, COL.panel)
  draw_info_label(x + half + gap + 12, y + 6, "KEY")
  draw_combo("tone", x + half + gap + 12, y + 22, tone_w, ch, KEY_TONES, state.tone_i)
  draw_combo("acc", x + half + gap + 12 + tone_w + 6, y + 22, acc_w, ch, KEY_ACC, state.acc_i, acc_label)
  y = y + row_h + gap

  fill_rect(x, y, half, row_h, COL.panel)
  draw_info_label(x + 12, y + 6, "SCALE")
  draw_combo("scale", x + 12, y + 22, combo_w, ch, KEY_SCALES, state.scale_i)
  fill_rect(x + half + gap, y, half, row_h, COL.panel)
  draw_info_label(x + half + gap + 12, y + 6, "STYLE")
  draw_combo("style", x + half + gap + 12, y + 22, combo_w, ch, KEY_STYLES, state.style_i)
  y = y + row_h + gap

  draw_row(x, y, half, row_h, "TEMPO MAP", tempo_summary(state.data.tempoMap))
  fill_rect(x + half + gap, y, half, row_h, COL.panel)
  draw_info_label(x + half + gap + 12, y + 6, "KITA")
  local kx = x + half + gap + 12
  local ky = y + 22
  fill_rect(kx, ky, kita_w, ch, COL.panel2)
  stroke_rect(kx, ky, kita_w, ch, state.kita_focus and COL.accent or COL.border)
  set_font(16)
  text_in_box(kx, ky, kita_w, ch, state.kita, COL.text)
  hit.kita = { x = kx, y = ky, w = kita_w, h = ch }
  y = y + row_h + gap

  local next_found = state.data.nextSongAt ~= nil
  fill_rect(x, y, half, row_h, COL.panel)
  local next_color = next_found and COL.ok or COL.err
  fill_rect(x, y, 4, row_h, next_color)
  set_font(13)
  text_at(x + 14, y + 8, "NEXT", COL.muted)
  set_font(16)
  local next_msg = next_found and format_duration(state.data.nextSongAt) or "Marker not found"
  text_at(x + 14, y + 28, next_msg, next_color, x + half - 12, y + row_h - 6)
  y = y + row_h + 14

  set_font(13)
  text_at(x, y, "TRACKS", COL.muted)
  y = y + 18

  local function track_chip(cx, cw, label, found, count, status, status_rgb)
    fill_rect(cx, y, cw, 48, COL.panel)
    local color = found and (count > 0 and COL.ok or COL.warn) or COL.err
    fill_rect(cx, y, 4, 48, color)
    set_font(13)
    text_at(cx + 14, y + 6, label, COL.muted, cx + cw - 8, y + 22)
    set_font(15)
    local msg = status
    if not msg then
      if not found then
        msg = "Track not found"
      elseif count == 0 then
        msg = "No item text"
      else
        msg = string.format("%d item%s", count, count == 1 and "" or "s")
      end
    end
    text_at(cx + 14, y + 24, msg, status_rgb or COL.text, cx + cw - 8, y + 44)
  end

  local flags = state.data.flags
  track_chip(x, half, "SECTION", flags.section_found, #state.data.sections)
  track_chip(x + half + gap, half, "LYRICS", flags.lyrics_found, #state.data.lyrics)
  y = y + 54
  track_chip(x, half, "CHORDS", flags.chords_found, #state.data.chords)
  track_chip(x + half + gap, half, "PATTERN", flags.pattern_found, #(state.data.patterns or {}))
  y = y + 58

  set_font(13)
  text_at(x, y, "AUDIO", COL.muted)
  set_font(13)
  local include_label = "Include in export"
  local tw = gfx.measurestr(include_label)
  text_at(x + w - tw, y, include_label, COL.muted)
  y = y + 18

  local audio_rows = {
    {
      key = "MASTER",
      found = true,
      exportable = true,
      status = "128 kbps MP3"
    },
    {
      key = "CLICK",
      found = state.data.click and state.data.click.found or false,
      exportable = click_exportable(state.data.click)
    }
  }
  for _, stem in ipairs(state.data.stems or {}) do
    audio_rows[#audio_rows + 1] = {
      key = stem.key,
      found = stem.found,
      exportable = stem.found
    }
  end

  local cols = 3
  local agap = 8
  local col_w = (w - agap * (cols - 1)) / cols
  local row_ah = 40
  local check_s = 14
  local rows_n = math.ceil(#audio_rows / cols)
  for i, row in ipairs(audio_rows) do
    local col = (i - 1) % cols
    local r = math.floor((i - 1) / cols)
    local cx = x + col * (col_w + agap)
    local cy = y + r * (row_ah + agap)
    fill_rect(cx, cy, col_w, row_ah, COL.panel)
    local status = row.status or (row.found and "found" or "Not found")
    local status_rgb = row.found and COL.ok or COL.err
    set_font(13)
    text_at(cx + 10, cy + 5, row.key, COL.text, cx + col_w - check_s - 16, cy + 22)
    set_font(12)
    text_at(cx + 10, cy + 22, status, status_rgb, cx + col_w - 8, cy + row_ah - 2)
    local on = wants_include(row.key, row.exportable)
    local box_x = cx + col_w - check_s - 8
    local box_y = cy + 6
    draw_checkbox(box_x, box_y, check_s, on, row.exportable)
    hit.checks[#hit.checks + 1] = {
      key = row.key,
      exportable = row.exportable,
      x = cx,
      y = cy,
      w = col_w,
      h = row_ah
    }
  end
  y = y + rows_n * (row_ah + agap) + 6

  set_font(13)
  text_at(x, y, "OUTPUT", COL.muted)
  y = y + 18
  local out = state.out_dir ~= "" and state.out_dir or LIBRARY_SONGS
  local show_browse = not path_matches_default()
  local browse_w = show_browse and 96 or 0
  local path_w = show_browse and (w - browse_w - 8) or w
  fill_rect(x, y, path_w, 36, COL.panel)
  set_font(13)
  text_at(x + 12, y + 10, out, COL.text, x + path_w - 12, y + 32)
  if show_browse then
    local bhov = mouse_in(x + path_w + 8, y, browse_w, 36)
    fill_rect(x + path_w + 8, y, browse_w, 36, bhov and COL.hover or COL.panel2)
    stroke_rect(x + path_w + 8, y, browse_w, 36, COL.border)
    text_in_box(x + path_w + 8, y, browse_w, 36, "Browse", COL.text)
    hit.browse_btn = { x = x + path_w + 8, y = y, w = browse_w, h = 36 }
  else
    hit.browse_btn = nil
  end
  y = y + 48

  local btn_w, btn_h = 118, 40
  local bx = x + w - btn_w
  local by = y
  local hovered = mouse_in(bx, by, btn_w, btn_h)
  fill_rect(bx, by, btn_w, btn_h, hovered and { 242, 196, 96 } or COL.btn)
  set_font(16)
  text_in_box(bx, by, btn_w, btn_h, "Export JSON", COL.btn_text)
  hit.export_btn = { x = bx, y = by, w = btn_w, h = btn_h }

  if state.status ~= "" then
    set_font(13)
    text_at(x, by + 10, state.status, state.status_ok and COL.ok or COL.err, bx - 12, by + btn_h)
  end

  draw_open_menu()
end

--------------------------------------------------------------------------------
-- Main loop
--------------------------------------------------------------------------------

gfx.init("DBK Stage Control Export", WIN_W, WIN_H, 0, 120, 80)
gfx.clear = COL.bg[1] + COL.bg[2] * 256 + COL.bg[3] * 65536

local last_scan = 0

local function shutdown()
  _G.DBK_STAGE_CONTROL_EXPORT_RUNNING = nil
  gfx.quit()
end

local function loop()
  local char = gfx.getchar()
  if char < 0 then
    shutdown()
    return
  end
  if char == 27 then
    if state.open_combo then
      state.open_combo = nil
    elseif state.kita_focus then
      state.kita_focus = false
    else
      shutdown()
      return
    end
  end

  local now = reaper.time_precise()
  if now - last_scan > 0.5 then
    state.data = collect_project()
    refresh_out_dir()
    last_scan = now
  end

  mouse.x, mouse.y = gfx.mouse_x, gfx.mouse_y
  mouse.down = gfx.mouse_cap & 1 == 1
  mouse.click = mouse.down and not mouse.prev
  mouse.consumed = false

  hit.export_btn = nil
  hit.browse_btn = nil
  hit.combos = {}
  hit.checks = {}
  hit.kita = nil
  hit.menu = nil
  draw()

  if state.kita_focus and char > 0 then
    if char == 8 or char == 127 then
      state.kita = "0"
      persist_project_settings()
    elseif char >= 48 and char <= 57 then
      state.kita = string.char(char)
      persist_project_settings()
    end
  end

  if not state.pending then
    if mouse.click and not mouse.consumed then
      local closed_combo
      if hit.menu then
        local picked = false
        for _, item in ipairs(hit.menu.items) do
          if mouse_in(item.x, item.y, item.w, item.h) then
            apply_combo_choice(hit.menu.id, item.i)
            picked = true
            mouse.consumed = true
            break
          end
        end
        closed_combo = state.open_combo
        state.open_combo = nil
        if picked or mouse_in(hit.menu.x, hit.menu.y, hit.menu.w, hit.menu.h) then
          mouse.consumed = true
        end
      end

      if not mouse.consumed then
        local combo_hit
        for _, c in ipairs(hit.combos) do
          if mouse_in(c.x, c.y, c.w, c.h) then
            combo_hit = c
            break
          end
        end
        if combo_hit then
          if closed_combo == combo_hit.id then
            state.open_combo = nil
          else
            state.open_combo = combo_hit.id
          end
          mouse.consumed = true
        end
      end
    end

    if mouse.click and not mouse.consumed then
      for _, c in ipairs(hit.checks) do
        if mouse_in(c.x, c.y, c.w, c.h) then
          toggle_include(c.key, c.exportable)
          mouse.consumed = true
          break
        end
      end
    end

    if mouse.click then
      local on_kita = hit.kita and mouse_in(hit.kita.x, hit.kita.y, hit.kita.w, hit.kita.h)
      if on_kita then
        state.kita_focus = true
        mouse.consumed = true
      else
        state.kita_focus = false
      end
    end

    if char == 13 and not mouse.consumed then
      if state.kita_focus then
        state.kita_focus = false
      else
        state.pending = "export"
      end
    end
    if mouse.click and not mouse.consumed and hit.browse_btn then
      if mouse_in(hit.browse_btn.x, hit.browse_btn.y, hit.browse_btn.w, hit.browse_btn.h) then
        state.pending = "browse"
        mouse.consumed = true
      end
    end
    if mouse.click and not mouse.consumed and hit.export_btn then
      if mouse_in(hit.export_btn.x, hit.export_btn.y, hit.export_btn.w, hit.export_btn.h) then
        state.pending = "export"
        mouse.consumed = true
      end
    end
  end

  mouse.prev = mouse.down
  gfx.update()

  if state.pending then
    local action = state.pending
    state.pending = nil
    if action == "browse" then
      choose_export_folder()
    elseif action == "export" then
      do_export()
    end
  end

  reaper.defer(loop)
end

reaper.defer(loop)
