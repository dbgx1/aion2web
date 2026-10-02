from pathlib import Path
source = Path('E:/project/aion2/client/mitm_ws_message_monitor.py')
s = source.read_text(encoding='utf-8')
def replace(old,new):
    global s
    assert old in s, old[:100]
    s=s.replace(old,new,1)
replace('2026-09-16.account-switch.1','2026-09-16.optional.1')
replace('class RuntimeState:', '''def _normalize_optional(value: Any) -> str | None:
    """Keep the original JSON string; reject empty, malformed or non-object metadata."""
    if isinstance(value, str):
        if not value.strip():
            return None
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            return None
        return value if isinstance(parsed, dict) and parsed else None
    if isinstance(value, dict) and value:
        return json.dumps(value, ensure_ascii=False, allow_nan=False)
    return None


class RuntimeState:''')
replace('''                self.data["userName"] = None
            for key, value in values.items():''','''                self.data["userName"] = None
                self.data["optional"] = None
                self.data["messageInfoTemplate"] = {}
                self.data["validationInfo"] = {}
                self.data["extraData"] = {}
            if "optional" in values:
                values["optional"] = _normalize_optional(values["optional"])
            for key, value in values.items():''')
replace('''        game_user_id: Any = None,
    ) -> None:''','''        game_user_id: Any = None,
        optional: Any = None,
    ) -> None:''')
replace('''            item["lastSeen"] = datetime.now(timezone.utc).isoformat()''','''            normalized_optional = _normalize_optional(optional)
            if normalized_optional:
                item["optional"] = normalized_optional
            item["lastSeen"] = datetime.now(timezone.utc).isoformat()''')
replace('''    ) -> None:
        self.remember_user(
            meta.get("senderCharacterId"),''','''    ) -> None:
        data = payload.get("jsonData") if isinstance(payload, dict) else None
        self.remember_user(
            meta.get("senderCharacterId"),''')
replace('''            user_name=meta.get("sender"),
            server_id=meta.get("serverId"),
        )''','''            user_name=meta.get("sender"),
            server_id=meta.get("serverId"),
            optional=data.get("optional") if isinstance(data, dict) else None,
        )''')
replace('''            if isinstance(data, dict) and _profile_name(data):''','''            if isinstance(data, dict):''')
replace('''                is_outgoing_ws = direction == "C->S"
                should_learn_self = (
                    is_current_character
                    or is_current_game_user
                    or is_outgoing_ws
                    or (not current_user_name and not current_character_id and data.get("optional"))
                )''','''                sender_server = data.get("serverId") or data.get("serverKey")
                with self.lock:
                    current_server = self.data.get("serverKey")
                same_server = (sender_server not in (None, "") and current_server not in (None, "")
                               and str(sender_server) == str(current_server))
                # An incoming stranger must never become the sender of console whispers.
                same_character = is_current_character or (is_current_game_user and
                    (not sender_character_id or not current_character_id))
                should_learn_self = same_server and same_character''')
replace('''            user_name = self.data.get("userName") or ""
            message_template''','''            user_name = self.data.get("userName") or ""
            optional = _normalize_optional(self.data.get("optional"))
            message_template''')
replace('''        message_info = {
            **message_template,''','''        if not optional:
            raise ValueError("缺少当前登录角色的有效 optional，未发送。请先在游戏内发送一条聊天消息，采集后重试。")

        message_info = {
            **message_template,''')
replace('''            "optional": "",
        }''','''            "optional": optional,
        }''')
replace('''        except Exception as exc:
            result = {'ok': False, 'error': str(exc)}
        ok = bool(result.get('ok'))''','''        except ValueError as exc:
            return self._receipt(request_id, status='not_sent', error=str(exc))
        except Exception as exc:
            result = {'ok': False, 'error': str(exc)}
        ok = bool(result.get('ok'))''')
Path('artifacts/mitm_ws_message_monitor.optional.py').write_text(s,encoding='utf-8')
print('Prepared client optional update')
