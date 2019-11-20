#!/usr/bin/env bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
. $DIR/helpers/_show-header.sh
TARGET=$1

show_header "building" $TARGET

if [ "$TARGET" == "prod" ]; then
    NODE_OPTIONS=${NODE_OPTIONS:-"--max_old_space_size=30000"}
    ng build --prod
elif [ "$TARGET" == "adfdev" ]; then
    $DIR/../adfdev/_adfdev-build.sh
else
    ng build
fi