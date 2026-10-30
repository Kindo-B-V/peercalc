#!/usr/bin/env bash

hosting_valid_port() {
    [[ $1 =~ ^[1-9][0-9]{0,4}$ && $1 -le 65535 ]]
}

collect_occupied_ports() {
    local listeners ids metadata published line port
    local -a engine=("$@") fields=() containers=()
    local -A used=()
    if [[ ${#engine[@]} -eq 0 ]]; then engine=(docker); fi
    listeners=$(ss -H -ltn) || { printf 'TCP-poorten konden niet worden gecontroleerd.\n' >&2; return 1; }
    while IFS= read -r line; do
        [[ -z $line ]] && continue
        read -r -a fields <<< "$line"
        [[ ${#fields[@]} -ge 4 ]] || { printf 'Ongeldige TCP-poortgegevens.\n' >&2; return 1; }
        port=${fields[3]##*:}
        hosting_valid_port "$port" || { printf 'Ongeldige TCP-poortgegevens.\n' >&2; return 1; }
        used[$port]=1
    done <<< "$listeners"
    ids=$("${engine[@]}" ps -q) || { printf 'Docker-poorten konden niet worden gecontroleerd.\n' >&2; return 1; }
    if [[ -n $ids ]]; then
        mapfile -t containers <<< "$ids"
        # Query only port metadata, never unrelated containers' environment secrets.
        metadata=$("${engine[@]}" inspect --format '{{json .NetworkSettings.Ports}}' -- "${containers[@]}") || { printf 'Docker-poorten konden niet worden gelezen.\n' >&2; return 1; }
        published=$(jq -sr --argjson expected "${#containers[@]}" '
            if length != $expected then error("incomplete inspect") else .[] end |
            if . == null then empty elif type != "object" then error("invalid ports") else
                to_entries[] | select(.key | endswith("/tcp")) | .value |
                if . == null then empty elif type != "array" then error("invalid bindings") else
                    .[].HostPort | if type == "string" and test("^[1-9][0-9]{0,4}$") then
                        if tonumber <= 65535 then . else error("invalid port") end
                    else error("invalid port") end
                end
            end' <<< "$metadata") || { printf 'Docker-poortgegevens zijn ongeldig.\n' >&2; return 1; }
        while IFS= read -r port; do
            [[ -z $port ]] || used[$port]=1
        done <<< "$published"
    fi
    if [[ ${#used[@]} -gt 0 ]]; then printf '%s\n' "${!used[@]}" | sort -n; fi
}

select_free_port() {
    local occupied=$1 start=${2:-8788} port
    local -A used=()
    hosting_valid_port "$start" && [[ $start -ge 1024 ]] || { printf 'Startpoort moet tussen 1024 en 65535 liggen.\n' >&2; return 1; }
    while IFS= read -r port; do
        [[ -z $port ]] && continue
        hosting_valid_port "$port" || { printf 'Ongeldige bezette poort.\n' >&2; return 1; }
        used[$port]=1
    done <<< "$occupied"
    for ((port = start; port <= 65535; port++)); do
        if [[ ! ${used[$port]+exists} ]]; then printf '%s\n' "$port"; return; fi
    done
    printf 'Geen vrije TCP-poort beschikbaar.\n' >&2
    return 1
}

configure_deployment() {
    local root=$1 occupied=$2 edge=${3:-false} gateway=${4:-} port line mode='' saved_port='' port_seen=false tmp
    local state="$1/.hosting/deployment.env" previous_mode='' previous_port=''
    local -A used=()
    [[ $edge == true || $edge == false ]] || { printf 'Ongeldige edge-status.\n' >&2; return 1; }
    [[ -z $gateway ]] || hosting_valid_port "$gateway" || { printf 'Ongeldige gateway-poort.\n' >&2; return 1; }
    [[ ! -L $root/.hosting && ! -L $state ]] || { printf 'Deploymentconfiguratie mag geen symlink zijn.\n' >&2; return 1; }
    while IFS= read -r port; do
        [[ -z $port ]] && continue
        hosting_valid_port "$port" || { printf 'Ongeldige bezette poort.\n' >&2; return 1; }
        used[$port]=1
    done <<< "$occupied"
    if [[ -e $state ]]; then
        [[ -f $state ]] || { printf 'Deploymentconfiguratie moet een normaal bestand zijn.\n' >&2; return 1; }
        while IFS= read -r line || [[ -n $line ]]; do
            case "$line" in
                PEERCALC_DEPLOYMENT_MODE=standalone|PEERCALC_DEPLOYMENT_MODE=proxy)
                    [[ -z $mode ]] || { printf 'Dubbele deploymentmodus.\n' >&2; return 1; }
                    mode=${line#*=} ;;
                PEERCALC_HTTP_PORT=*)
                    [[ $port_seen == false ]] || { printf 'Dubbele deploymentpoort.\n' >&2; return 1; }
                    port_seen=true
                    saved_port=${line#*=} ;;
                *) printf 'Ongeldige deploymentconfiguratie.\n' >&2; return 1 ;;
            esac
        done < "$state"
        [[ -n $mode && -n $saved_port ]] || { printf 'Deploymentconfiguratie is onvolledig.\n' >&2; return 1; }
        if [[ $mode == standalone ]]; then
            [[ $saved_port == 0 ]] || { printf 'Standalone-poort moet 0 zijn.\n' >&2; return 1; }
        else
            hosting_valid_port "$saved_port" && [[ $saved_port -ge 8788 ]] || { printf 'Ongeldige opgeslagen proxypoort.\n' >&2; return 1; }
        fi
        previous_mode=$mode previous_port=$saved_port
    fi
    if [[ $mode != proxy ]]; then
        if [[ $edge == true || ( ! ${used[80]+exists} && ! ${used[443]+exists} ) ]]; then
            mode=standalone saved_port=0
        else
            mode=proxy saved_port=''
        fi
    fi
    if [[ $mode == proxy ]]; then
        if [[ -z $saved_port || ( ${used[$saved_port]+exists} && $gateway != "$saved_port" ) ]]; then
            saved_port=$(select_free_port "$occupied") || return 1
        fi
        if [[ -n $previous_mode && ( $previous_mode != "$mode" || $previous_port != "$saved_port" ) ]]; then
            printf 'Deployment wijzigt van %s:%s naar proxy:%s; pas de bestaande HTTPS-proxyroute aan naar 127.0.0.1:%s.\n' "$previous_mode" "$previous_port" "$saved_port" "$saved_port" >&2
        fi
    fi
    install -d -m 0700 "$root/.hosting" || return 1
    if [[ $previous_mode != "$mode" || $previous_port != "$saved_port" ]]; then
        tmp=$(mktemp "$root/.hosting/deployment.env.XXXXXX") || return 1
        if ! { printf 'PEERCALC_DEPLOYMENT_MODE=%s\nPEERCALC_HTTP_PORT=%s\n' "$mode" "$saved_port" > "$tmp" && chmod 0600 "$tmp" && mv -f -- "$tmp" "$state"; }; then
            rm -f -- "$tmp"
            return 1
        fi
    else
        chmod 0600 "$state" || return 1
    fi
    PEERCALC_DEPLOYMENT_MODE=$mode PEERCALC_HTTP_PORT=$saved_port
    export -n PEERCALC_DEPLOYMENT_MODE PEERCALC_HTTP_PORT
}
