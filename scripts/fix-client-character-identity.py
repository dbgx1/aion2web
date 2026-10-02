"""Apply the reviewed identity-name fix to the neighboring client source."""
from pathlib import Path

path = Path('E:/project/aion2/client/mitm_ws_message_monitor.py')
text = path.read_text(encoding='utf-8')
text = text.replace('ADDON_BUILD = "2026-09-10.reliable-mqtt"', 'ADDON_BUILD = "2026-09-11.character-name.2"')
anchor = 'class RuntimeState:\n'
helper = '''def _profile_name(profile: dict[str, Any]) -> str | None:
    for key in ("userName", "characterName", "alias"):
        value = profile.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


'''
assert anchor in text and 'def _profile_name(' not in text
text = text.replace(anchor, helper + anchor, 1)
old = '''        with self.lock:
            for key, value in values.items():
                if value not in (None, ""):
                    self.data[key] = value
                    changed = True
            if changed:
                self.data["lastUpdated"] = datetime.now(timezone.utc).isoformat()
'''
new = '''        with self.lock:
            identity_changed = any(
                values.get(key) not in (None, "")
                and str(values[key]) != str(self.data.get(key))
                for key in ("characterId", "serverKey")
            )
            if identity_changed:
                self.data["userName"] = None
            for key, value in values.items():
                if value not in (None, ""):
                    self.data[key] = value
                    changed = True
            if not self.data.get("userName"):
                known = self.data["knownUsers"].get(str(self.data.get("characterId")), {})
                if (self.data.get("serverKey") not in (None, "")
                        and str(known.get("serverKey")) == str(self.data["serverKey"])):
                    self.data["userName"] = _profile_name(known)
            if changed:
                self.data["lastUpdated"] = datetime.now(timezone.utc).isoformat()
'''
assert text.count(old) == 1
text = text.replace(old, new, 1)
old = '''            item = users.setdefault(key, {})
            item["characterId"] = key
'''
new = '''            item = users.setdefault(key, {})
            if (server_id not in (None, "") and item.get("serverKey") not in (None, "")
                    and str(server_id) != str(item["serverKey"])):
                item.clear()
            item["characterId"] = key
'''
assert text.count(old) == 1
text = text.replace(old, new, 1)
old = '''            item["lastSeen"] = datetime.now(timezone.utc).isoformat()
            self.data["lastUpdated"] = item["lastSeen"]
'''
new = '''            item["lastSeen"] = datetime.now(timezone.utc).isoformat()
            self.data["lastUpdated"] = item["lastSeen"]
            if (key == str(self.data.get("characterId"))
                    and server_id not in (None, "")
                    and str(server_id) == str(self.data.get("serverKey"))):
                name = _profile_name({"userName": user_name})
                if name:
                    self.data["userName"] = name
'''
assert text.count(old) == 1
text = text.replace(old, new, 1)
text = text.replace('userName=body.get("userName") or body.get("alias"),', 'userName=_profile_name(body),')
text = text.replace('userName=message_info.get("userName"),', 'userName=_profile_name(message_info),')
text = text.replace('userName=profile.get("userName") or profile.get("alias"),', 'userName=_profile_name(profile),')
text = text.replace('if isinstance(data, dict) and data.get("userName"):', 'if isinstance(data, dict) and _profile_name(data):')
compile(text, str(path), 'exec')
path.write_text(text, encoding='utf-8')
print('Updated client identity parsing and profile-to-heartbeat propagation.')
