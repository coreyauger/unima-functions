#!/bin/bash

list=(./*/package.json)          # grab the list
for file in "${list[@]}"; do (cd `dirname "$file"`; npm run libs) done  # loop over the array