#!/bin/bash
# SPDX-License-Identifier: GPL-2.0
#
# Copyright (C) 2015-2019 Jason A. Donenfeld <Jason@zx2c4.com>. All Rights Reserved.
#
# Modified by EchoEkhi to use with automated software in 2020.

IPP=$(dig +short myip.opendns.com @resolver1.opendns.com)
export ENDERPOINT=$IPP

exec < <(exec wg show all dump)

printf '{ '
printf '"peers": ['
while read -r -d $'\t' device; do
	read -r public_key private_key preshared_key listen_port endpoint allowed_ips latest_handshake transfer_rx transfer_tx persistent_keepalive
		printf '%s\t{\n' "$delim" 
		delim=$'\n'
		{ printf '%s\t\t"publicKey": "%s"' '' "$private_key"; delim=$',\n'; }
		{ printf '%s\t\t"endpoint": "%s"' "$delim"  "$ENDERPOINT:$preshared_key"; delim=$',\n'; }
		{ printf '%s\t\t"latestHandshake": %u' "$delim" $(( $latest_handshake )); delim=$',\n'; }
		{ printf '%s\t\t"upload": %u' "$delim" $(( $transfer_rx )); delim=$',\n'; }
		{ printf '%s\t\t"download": %u' "$delim" $(( $transfer_tx )); delim=$'\n'; }
		
		
		printf '%s\t\t' "$delim"
		printf '\n\t}'
		delim=$',\n'
		printf '%s\n' "$end"
printf ']'
printf '}\n'
	break


done
