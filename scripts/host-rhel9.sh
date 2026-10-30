#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { printf 'Fout: %s\n' "$*" >&2; exit 1; }

source "$(dirname -- "${BASH_SOURCE[0]}")/hosting-ports.sh"

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

install_host_packages() {
    local -a packages=(dnf-plugins-core openssl jq util-linux iproute)
    # Rocky/RHEL's curl-minimal already supports our HTTPS and --resolve requests.
    if ! command -v curl > /dev/null; then packages+=(curl); fi
    dnf -y install "${packages[@]}"
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

write_proxy_examples() {
    local root=$1 domain=$2 port=$3
    validate_domain "$domain"
    [[ $port =~ ^[0-9]+$ && $port -ge 1024 && $port -le 65535 ]] || fail 'Ongeldige proxy-backendpoort.'
    [[ ! -L $root/.hosting/nginx-location.conf && ! -L $root/.hosting/Caddyfile.proxy ]] || fail 'Proxyvoorbeelden mogen geen symlinks zijn.'
    printf '# Generated example; copy into the HTTPS server block for %s.\n# Keep certificates and the existing server configuration.\nlocation / {\n    proxy_pass http://127.0.0.1:%s;\n    proxy_set_header Host %s;\n    proxy_set_header X-Forwarded-Host %s;\n    proxy_set_header X-Forwarded-Proto https;\n    proxy_set_header X-Forwarded-Port 443;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_read_timeout 90s;\n    proxy_buffer_size 16k;\n    proxy_buffers 8 16k;\n    client_max_body_size 20m;\n}\n' "$domain" "$port" "$domain" "$domain" > "$root/.hosting/nginx-location.conf"
    printf '# Generated example; merge into the existing Caddy configuration.\n%s {\n    reverse_proxy 127.0.0.1:%s\n}\n' "$domain" "$port" > "$root/.hosting/Caddyfile.proxy"
}

main() {
    if [[ ${1:-} == --help || ${1:-} == -h ]]; then
        printf 'Gebruik: sudo %s [domeinnaam]\nZet DNS naar deze server. Bij bezette 80/443 kiest het script een vrije lokale backendpoort voor je bestaande HTTPS-proxy.\n' "$0"
        return
    fi
    [[ $# -le 1 ]] || fail 'Verwacht precies een domeinnaam, zonder andere argumenten.'
    local domain=${1:-} root value occupied edge_id gateway_id gateway_port='' edge_running=false
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
    install_host_packages
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
    unset COMPOSE_PROFILES
    occupied=$(collect_occupied_ports "${engine[@]}") || fail 'Bezetting van lokale poorten kon niet veilig worden bepaald.'
    edge_id=$("${engine[@]}" ps -q --filter label=com.docker.compose.project=peercalc-hosting --filter label=com.docker.compose.service=edge)
    if [[ -n $edge_id ]]; then edge_running=true; fi
    gateway_id=$("${engine[@]}" ps -q --filter label=com.docker.compose.project=peercalc-hosting --filter label=com.docker.compose.service=gateway)
    if [[ -n $gateway_id ]]; then
        [[ $gateway_id != *$'\n'* ]] || fail 'Meerdere hosting-gateways gevonden; controleer de bestaande installatie.'
        gateway_port=$("${engine[@]}" inspect "$gateway_id" | jq -r '.[0].NetworkSettings.Ports["8080/tcp"] // [] | map(select(.HostIp == "127.0.0.1") | .HostPort) | unique | if length > 1 then error("Ambiguous gateway ports") else .[0] // "" end')
    fi
    configure_deployment "$root" "$occupied" "$edge_running" "$gateway_port" || fail 'Er kon geen veilige hostingpoort worden gekozen.'
    local -a compose=("${engine[@]}" compose --project-name peercalc-hosting --env-file .env.hosting --env-file .hosting/deployment.env -f compose.hosting.yaml)
    local -a services=()
    if [[ $PEERCALC_DEPLOYMENT_MODE == proxy ]]; then
        compose+=(-f compose.proxy.yaml)
        services=(gateway)
        write_proxy_examples "$root" "$domain" "$PEERCALC_HTTP_PORT"
        printf '80/443 blijven bij je bestaande webserver. PeerCalc-backend: 127.0.0.1:%s\n' "$PEERCALC_HTTP_PORT"
    fi
    "${compose[@]}" config --quiet
    getent ahosts "$domain" > /dev/null || fail 'Domein resolveert nog niet. Stel eerst DNS in en start opnieuw.'
    if [[ $PEERCALC_DEPLOYMENT_MODE == standalone ]] && systemctl is-active --quiet firewalld; then
        for value in http https; do
            firewall-cmd --permanent --add-service="$value"
            firewall-cmd --add-service="$value"
        done
    elif [[ $PEERCALC_DEPLOYMENT_MODE == standalone ]]; then
        printf 'Firewalld is niet actief; controleer zelf de server- en providerfirewall voor TCP 80/443.\n'
    fi
    "${compose[@]}" up --build -d --wait --wait-timeout 300 "${services[@]}"
    if [[ $PEERCALC_DEPLOYMENT_MODE == proxy ]]; then
        curl --fail --silent --show-error --noproxy '*' --connect-timeout 5 --max-time 15 "http://127.0.0.1:$PEERCALC_HTTP_PORT/healthz" -o /dev/null
        [[ $(curl --silent --show-error --noproxy '*' --connect-timeout 5 --max-time 15 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PEERCALC_HTTP_PORT/api/projects") == 401 ]] || fail 'De lokale backend is niet correct afgeschermd.'
        printf '\nBackend gereed op 127.0.0.1:%s (alleen lokaal).\nKoppel https://%s in je bestaande reverse proxy aan deze backend.\nVoorbeelden: %s/.hosting/nginx-location.conf en %s/.hosting/Caddyfile.proxy\nVoor een proxy in Docker: zie docs/HOSTING_RHEL9.md; container-localhost is niet de server.\nAccount: owner@%s; wachtwoord: PEERCALC_OWNER_PASSWORD in .env.hosting.\nPublieke HTTPS/certificaten zijn in deze modus nog NIET geconfigureerd of geverifieerd.\n' "$PEERCALC_HTTP_PORT" "$domain" "$root" "$root" "$domain"
        return
    fi
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
