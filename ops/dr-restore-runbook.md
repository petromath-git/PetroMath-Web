# Prod Disaster Recovery: Restore from AMI + Latest DB Data

Covers the scenario: something is wrong with the current prod instance/code, and you want
to go back to a known-good AMI snapshot (app code + OS + config as of that snapshot) while
still keeping the freshest possible business data (from the 15-min S3 DB backups, which are
far more current than any AMI).

AMIs are created daily at 23:00 IST by DLM policy `policy-0b54e96fd1186ded0` (3-day
retention, no forced reboot). DB backups land in `s3://mysql-backups-petromath/`:
`mysql-backups/hourly/` (actually every 15 min, kept 24h) and `mysql-backups/daily/`
(kept 7 days).

**Before touching anything, decide which scenario you're actually in:**

| You want to... | Do this instead |
|---|---|
| Roll back app code only, DB is fine | `git checkout <old commit>` on the **current** instance + `pm2 restart petromath`. No AMI needed. |
| Roll back everything to exactly the AMI's state (accept losing recent data) | Launch from the AMI, skip the DB restore step below entirely. |
| Roll back code to N days ago but keep today's data | Full procedure below. |

## Step 1 — Pick the AMI

```bash
aws ec2 describe-images --owners self --region us-east-1 \
  --filters "Name=name,Values=petromath-prod*" \
  --query 'Images[].[ImageId,Name,CreationDate]' --output table
```

Pick the `ImageId` for the snapshot you want (only 3 days of these exist at any time).

## Step 2 — Launch a replacement instance from that AMI

```bash
aws ec2 run-instances --region us-east-1 \
  --image-id <ami-id> \
  --instance-type t3.medium \
  --key-name <existing key pair name> \
  --security-group-ids <same SG as i-0a0938f8ccfafafca> \
  --subnet-id <same subnet> \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=petromath-DR-restore}]'
```

Get the current instance's SG/subnet first with:
```bash
aws ec2 describe-instances --instance-ids i-0a0938f8ccfafafca --region us-east-1 \
  --query 'Reservations[0].Instances[0].[SubnetId,SecurityGroups[0].GroupId,KeyName]'
```

Since MySQL and the app share the one root volume, the new instance boots with both the
app code/config **and** the DB data exactly as of the AMI's snapshot time.

## Step 3 — Point traffic at the new instance

Only once you've verified the new instance works (Step 5). Options, in order of
preference:
- If prod uses an Elastic IP, re-associate it to the new instance (fast, no DNS TTL wait).
- Otherwise update the DNS record for `www.petromath.co.in` / `petromath.co.in` to the new
  instance's IP and wait out the TTL.

Don't do this before Step 4 — you'd be sending live traffic to an instance whose DB is
still several days stale.

## Step 4 — Restore latest DB data on top of the AMI's DB

SSH into the **new** instance and run the helper script:

```bash
cd ~/petroMath
./ops/restore-latest-db-backup.sh
```

By default it pulls the most recent **daily** backup. To grab the freshest possible
(up to 15 minutes old) instead:

```bash
./ops/restore-latest-db-backup.sh hourly
```

The script is destructive by design (it drops and recreates `petromath_prod`) — it prints
what it's about to do and requires typing `yes` to continue. Read [restore-latest-db-backup.sh](restore-latest-db-backup.sh)
before running it the first time.

## Step 5 — Verify before cutting over

```bash
pm2 list
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```

Log in and spot-check a recent transaction to confirm the data is current, then do Step 3.

## Step 6 — Clean up

Once the new instance is confirmed good and traffic is cut over, terminate the old
instance (if it's still running) and update `reference_full_deploy_setup` memory / this
repo's notes with the new instance ID if it's meant to be the new permanent prod box.
