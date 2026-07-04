-- Security hardening (finding #6, HIGH): close the _webhook_url_safe SSRF
-- bypass. The original (20260619130000:32-62) wrapped the private-range inet
-- check in `exception when others then null` that RETURNS TRUE (allows) on any
-- cast failure, on the assumption that a non-IP host is a DNS name. But several
-- IP encodings do NOT cast to inet and so were allowed straight through:
--   * dotless decimal integer   2130706433        (= 127.0.0.1)
--   * hex                        0x7f000001
--   * bracketed IPv6 literal     [::1]  — the old ':'-split left "[", which
--                                 also fails the cast and was permitted
-- Any of these reaches an internal target (loopback / link-local metadata).
--
-- New policy: classify the host. If it is IP-SHAPED (all-numeric dotted, or
-- contains a colon = IPv6, or an obfuscated numeric/hex form), it MUST parse as
-- inet AND fall outside the private/loopback/link-local/special ranges, else
-- DENY — an unparseable IP-shaped host is denied, not allowed. Only genuine DNS
-- hostnames (containing letters, not hex/0x/dotless-decimal) keep the
-- allow-on-non-IP behavior. DNS rebinding (a name that resolves to a private IP
-- at request time) remains a documented residual — pure SQL cannot resolve DNS.
create or replace function public._webhook_url_safe(p_url text)
returns boolean language plpgsql immutable security definer set search_path = '' as $$
declare
  v_host  text;
  v_ipish boolean;
  v_inet  inet;
begin
  if p_url is null or lower(p_url) not like 'https://%' then
    return false;
  end if;

  -- host = between scheme and the first '/', '?' or '#'; strip any userinfo.
  v_host := lower(split_part(regexp_replace(substring(p_url from 9), '[/?#].*$', ''), '@', -1));

  -- Strip an IPv6 bracket wrapper ([::1]:443 -> ::1); otherwise strip an
  -- IPv4/host :port. (Splitting a bare IPv6 on ':' would corrupt it, which is
  -- exactly how the old code let [::1] through.)
  if left(v_host, 1) = '[' then
    v_host := split_part(substring(v_host from 2), ']', 1);
  else
    v_host := split_part(v_host, ':', 1);
  end if;

  if v_host is null or v_host = '' then
    return false;
  end if;

  -- Named internal / metadata targets.
  if v_host in ('localhost', 'metadata.google.internal', '169.254.169.254')
     or v_host like '%.internal' or v_host like '%.local' or v_host like '%.localhost' then
    return false;
  end if;

  -- Obfuscated numeric encodings that are never valid DNS names and are the
  -- classic range-check bypass: dotless decimal integer, and hex (0x…) in any
  -- octet. Reject outright.
  if v_host ~ '^[0-9]+$' or v_host ~ '^0x' or v_host ~ '\.0x' then
    return false;
  end if;

  -- IP-shaped? IPv4 = all-numeric dotted; IPv6 = contains a colon.
  v_ipish := (v_host ~ '^[0-9.]+$' and position('.' in v_host) > 0)
             or position(':' in v_host) > 0;

  if v_ipish then
    -- Leading-zero octet = octal obfuscation (inet reads it as decimal); reject.
    if v_host ~ '(^|\.)0[0-9]' then
      return false;
    end if;
    -- Must parse as inet; an IP-shaped host that will not parse is DENIED
    -- (this is the core fix — the old code allowed it).
    begin
      v_inet := v_host::inet;
    exception when others then
      return false;
    end;
    if v_inet <<= any (array[
        '127.0.0.0/8','10.0.0.0/8','172.16.0.0/12','192.168.0.0/16',
        '169.254.0.0/16','0.0.0.0/8','::1/128','fc00::/7','fe80::/10'
      ]::inet[]) then
      return false;
    end if;
    return true;  -- a public IP literal is allowed
  end if;

  -- Plain DNS hostname: allowed (DNS rebinding stays a documented residual).
  return true;
end; $$;

-- Internal helper (called only from the definer engine); keep it off the direct
-- REST surface, matching 20260621130000.
revoke execute on function public._webhook_url_safe(text)
  from public, anon, authenticated;
