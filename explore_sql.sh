#!/bin/bash
cd C:/Users/acer/crm_review/backend
# find all route files and extract query calls with their SQL and parameters
for f in src__routes__*.ts; do
  echo "=== $f ==="
  rg -n "prepare\(|\.query\(|\.run\(|\.all\(|\.get\(|\.execute\(" "$f" | head -200
done
