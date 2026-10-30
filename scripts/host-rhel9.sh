#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { printf 'Fout: %s\n' "$*" >&2; exit 1; }

validate_domain() {
    local domain=$1 label
    [[ ${#domain} -le 253 && $domain == *.* && $domain != *..* && $domain =~ ^[a-z0-9.-]+$ ]] || fail 'Geef een volledige domeinnaam zonder https://, poort of pad.'
    [[ $domain =~ \.[a-z][a-z0-9-]*$ ]] || fail 'Een publiek DNS-domein is vereist, geen IP-adres.'
    local -a labels
    IFS=. read -r -a labels <<< "$domain"
    for label in "${labels[@]}"; do
        [[ ${#label} -le 63 && $label =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || fail 'Ongeldige domeinnaam.'
    done
    [[ $domain != .* && $domain != *. ]] || fail 'Ongeldige domeinnaam.'
    case "$domain" in
        *.localhost|*.local|*.internal|*.test|*.invalid|*.onion|*.home.arpa) fail 'Gebruik een publiek DNS-domein.' ;;
    esac
}

validate_email() {
    [[ $1 =~ ^[A-Za-z0-9._%+-]+@[a-z0-9.-]+$ ]] || fail 'ACME_EMAIL moet een normaal e-mailadres zijn.'
    validate_domain "${1#*@}"
}

check_rhel() {
    local ID='' VERSION_ID=''
    # This is the operating system's root-owned release file, not user input.
    source "${1:-/etc/os-release}"
    [[ ( $ID == rhel || $ID == rocky ) && $VERSION_ID =~ ^9(\.|$) ]] || fail "Dit script ondersteunt RHEL 9 en Rocky Linux 9; aangetroffen: ${ID:-onbekend} ${VERSION_ID:-onbekend}. Controleer /etc/os-release."
}

configure_hosting() (
    local root=$1 domain=$2 email=$3 tmp='' key value line
    local -A seen=()
    validate_domain "$domain"
    validate_email "$email"
    [[ ! -L $root/.env.hosting && ! -L $root/.hosting ]] || fail 'Configuratiepaden mogen geen symlinks zijn.'
    install -d -m 0700 "$root/.hosting"
    trap '[[ -z "$tmp" ]] || rm -f -- "$tmp"' EXIT
    if [[ ! -e $root/.env.hosting ]]; then
        tmp=$(mktemp "$root/.env.hosting.XXXXXX")
        {
            printf 'PEERCALC_DOMAIN=%s\nACME_EMAIL=%s\n' "$domain" "$email"
            for key in PEERCALC_CLIENT_SECRET PEERCALC_ADMIN_PASSWORD PEERCALC_OWNER_PASSWORD PEERCALC_DB_PASSWORD CALC_CONVERTER_TOKEN; do
                value=$(openssl rand -hex 32)
                printf '%s=%s\n' "$key" "$value"
            done
            value=$(openssl rand -base64 32 | tr '/+' '_-' | tr -d '=\n')
            printf 'PEERCALC_COOKIE_SECRET=%s\n' "$value"
        } > "$tmp"
        # Atomic creation without replacing secrets from an earlier installation.
        ln "$tmp" "$root/.env.hosting" || fail '.env.hosting werd ondertussen aangemaakt; start opnieuw.'
        rm -f -- "$tmp"
        tmp=''
    fi
    [[ -f $root/.env.hosting ]] || fail '.env.hosting is geen normaal bestand.'
    chmod 0600 "$root/.env.hosting"
    while IFS= read -r line || [[ -n $line ]]; do
        [[ $line =~ ^([A-Z_]+)=(.*)$ ]] || fail 'Ongeldige regel in .env.hosting.'
        key=${BASH_REMATCH[1]} value=${BASH_REMATCH[2]}
        [[ ! ${seen[$key]+exists} ]] || fail "Dubbele instelling: $key."
        seen[$key]=1
        case "$key" in
            PEERCALC_DOMAIN) [[ $value == "$domain" ]] || fail 'Domein wijzigen vereist een bewuste OIDC-migratie; bestaande installatie blijft intact.' ;;
            ACME_EMAIL) validate_email "$value" ;;
            PEERCALC_COOKIE_SECRET) [[ $value =~ ^[A-Za-z0-9_-]{43}$ ]] || fail 'Ongeldig cookiesecret.' ;;
            PEERCALC_CLIENT_SECRET|PEERCALC_ADMIN_PASSWORD|PEERCALC_OWNER_PASSWORD|PEERCALC_DB_PASSWORD|CALC_CONVERTER_TOKEN)
                [[ $value =~ ^[a-f0-9]{64}$ ]] || fail "Ongeldig of onvolledig secret: $key." ;;
            *) fail "Onbekende instelling in .env.hosting: $key." ;;
        esac
    done < "$root/.env.hosting"
    for key in PEERCALC_DOMAIN ACME_EMAIL PEERCALC_CLIENT_SECRET PEERCALC_COOKIE_SECRET PEERCALC_ADMIN_PASSWORD PEERCALC_OWNER_PASSWORD PEERCALC_DB_PASSWORD CALC_CONVERTER_TOKEN; do
        [[ ${seen[$key]+exists} ]] || fail "Instelling ontbreekt: $key. Herstel de configuratie; bestaande secrets worden niet vervangen."
    done
    [[ ! -L $root/.hosting/peercalc-realm.json ]] || fail 'Realm-configuratie mag geen symlink zijn.'
    if [[ ! -e $root/.hosting/peercalc-realm.json ]]; then
        tmp=$(mktemp "$root/.hosting/realm.XXXXXX")
        jq --arg owner "owner@$domain" '
            .registrationAllowed = false | .sslRequired = "external" |
            .users[0] |= (.username = $owner | .email = $owner | .firstName = "PeerCalc" | .lastName = "Owner")
        ' "$root/infra/peercalc-realm.json" > "$tmp"
        # Keycloak reads a file bind mount as UID 1000. Secrets remain placeholders.
        chmod 0644 "$tmp"
        mv "$tmp" "$root/.hosting/peercalc-realm.json"
        tmp=''
    fi
    jq -e --arg owner "owner@$domain" '.realm == "peercalc" and .registrationAllowed == false and .sslRequired == "external" and .users[0].username == $owner' "$root/.hosting/peercalc-realm.json" > /dev/null || fail 'Controleer de gesloten hosting-realmconfiguratie.'
)

clear_hosting_overrides() {
    local key
    # Exported shell values otherwise take precedence over Compose's --env-file.
    for key in "${!PEERCALC_@}" CALC_CONVERTER_TOKEN ACME_EMAIL; do unset "$key"; done
}

main() {
    if [[ ${1:-} == --help || ${1:-} == -h ]]; then
        printf 'Gebruik: sudo %s [domeinnaam]\nZet vooraf de A/AAAA-records naar deze server en maak TCP 80/443 bereikbaar.\n' "$0"
        return
    fi
    [[ $# -le 1 ]] || fail 'Verwacht precies een domeinnaam, zonder andere argumenten.'
    local domain=${1:-} root value
    local -a engine=(docker --host unix:///var/run/docker.sock)
    if [[ -z $domain ]]; then read -r -p 'Domeinnaam voor PeerCalc: ' domain; fi
    domain=${domain,,}
    validate_domain "$domain"
    [[ $EUID -eq 0 ]] || fail 'Start dit script met sudo.'
    check_rhel
    root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
    [[ -f $root/compose.hosting.yaml && -f $root/web/Dockerfile ]] || fail 'Start het script vanuit de volledige PeerCalc-repository.'
    cd "$root"
    trap 'printf "Hosting niet afgerond. Controleer de fout hierboven; data en secrets zijn behouden.\n" >&2' ERR
    dnf -y install dnf-plugins-core openssl jq curl util-linux iproute
    if ! command -v docker > /dev/null; then
        for value in podman podman-docker runc; do
            if rpm -q "$value" > /dev/null 2>&1; then
                fail 'Podman/runc is geinstalleerd. Los Docker-packageconflicten bewust op; dit script verwijdert geen bestaande runtimes.'
            fi
        done
        dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
        dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    fi
    unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH DOCKER_API_VERSION
    "${engine[@]}" --version | grep -q 'Docker version' || fail 'Een echte Docker Engine is vereist; een Podman-alias wordt niet gebruikt.'
    "${engine[@]}" compose version > /dev/null || fail 'Installeer de Docker Compose-plugin.'
    "${engine[@]}" compose up --help | grep -q -- '--wait-timeout' || fail 'Werk de Docker Compose-plugin bij; --wait-timeout is vereist.'
    systemctl enable --now docker
    "${engine[@]}" info > /dev/null
    [[ ! -L .hosting ]] || fail '.hosting mag geen symlink zijn.'
    install -d -m 0700 .hosting
    [[ ! -L .hosting/install.lock && ( ! -e .hosting/install.lock || -f .hosting/install.lock ) ]] || fail 'Ongeldig installatie-lockbestand.'
    exec 9>>.hosting/install.lock
    flock -n 9 || fail 'Er draait al een PeerCalc-hostinginstallatie.'
    configure_hosting "$root" "$domain" "${ACME_EMAIL:-owner@$domain}"
    clear_hosting_overrides
    local -a compose=("${engine[@]}" compose --project-name peercalc-hosting --env-file .env.hosting -f compose.hosting.yaml)
    "${compose[@]}" config --quiet
    getent ahosts "$domain" > /dev/null || fail 'Domein resolveert nog niet. Stel eerst DNS in en start opnieuw.'
    if [[ -z $("${engine[@]}" ps -q --filter label=com.docker.compose.project=peercalc-hosting --filter label=com.docker.compose.service=edge) ]] &&
        [[ -n $(ss -H -ltn '( sport = :80 or sport = :443 )') ]]; then
        fail 'Poort 80 of 443 is al bezet. Bestaande webservers worden niet gestopt.'
    fi
    if systemctl is-active --quiet firewalld; then
        for value in http https; do
            firewall-cmd --permanent --add-service="$value"
            firewall-cmd --add-service="$value"
        done
    else
        printf 'Firewalld is niet actief; controleer zelf de server- en providerfirewall voor TCP 80/443.\n'
    fi
    "${compose[@]}" up --build -d --wait --wait-timeout 300
    printf 'Wachten op een geldig publiek HTTPS-certificaat voor %s...\n' "$domain"
    local ready=false
    for value in {1..36}; do
        if curl --fail --silent --show-error --noproxy "$domain" --resolve "$domain:443:127.0.0.1" --connect-timeout 5 --max-time 10 "https://$domain/" -o /dev/null 2>/dev/null; then ready=true; break; fi
        sleep 5
    done
    [[ $ready == true ]] || fail 'HTTPS-validatie mislukt. Controleer DNS (ook AAAA), bereikbaarheid van 80/443 en de edge-containerlogs; draai daarna hetzelfde script opnieuw.'
    [[ $(curl --silent --show-error --noproxy "$domain" --resolve "$domain:443:127.0.0.1" --connect-timeout 5 --max-time 15 -o /dev/null -w '%{http_code}' "https://$domain/api/projects") == 401 ]] || fail 'Anonieme API-toegang is niet correct afgeschermd.'
    printf '\nPeerCalc: https://%s\nAccount: owner@%s\nWachtwoord: PEERCALC_OWNER_PASSWORD in %s/.env.hosting\nBeheerwachtwoord: PEERCALC_ADMIN_PASSWORD in hetzelfde private bestand.\nGebruik voor beheer docker --host unix:///var/run/docker.sock compose --project-name peercalc-hosting --env-file .env.hosting -f compose.hosting.yaml.\nMaak back-ups voordat je echte klantdata opslaat; zie docs/HOSTING_RHEL9.md.\n' "$domain" "$domain" "$root"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
