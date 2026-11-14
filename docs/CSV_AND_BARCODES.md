# Bevy CSV import and barcode validation

## Import (`/admin/import`)

1. In Bevy, export the attendee list as CSV, with all columns.
2. In the app, open **Import CSV** and choose the file. The server validates the file and shows a summary **without writing anything**:
   - Required columns: `Order number`, `Ticket number`, `First Name`, `Last Name`, `Email`, `Ticket title`, `Checkin Date (UTC)`. Header matching ignores case and extra spaces, and BOMs are handled. Any other columns are kept as extra data.
   - **Errors (row skipped):** missing ticket number, ticket numbers with unexpected characters, duplicate ticket numbers (every copy is skipped until you fix the file).
   - **Warnings (row imported):** no name, odd-looking email, a ticket that doesn't end in 7 digits (manual lookup only), a barcode suffix shared with another ticket (scans of it are rejected).
   - **Diff against what is already imported:** new, updated and unchanged rows, registrations missing from this file, and how many existing claims will be preserved.
3. Click **Import**.

### Reimporting updated exports

Reimport as often as you need. An import only overwrites the CSV fields. It **never touches swag claims or organizer eligibility overrides**. Registrations that are missing from a newer export are flagged "not in latest import". By default that makes them ineligible, which you can change under Inventory & rules. They are never deleted.

The full Bevy ticket number (for example `GOOGA263469041`) is the registration ID. Names are never used as identifiers.

### Exports

From the dashboard you can download **Attendees CSV** (each attendee with eligibility and claim details) and **Audit CSV** (every event).

## Barcode format (observed, not officially specified)

```
Scanned barcode:  132774:3469041
                  └prefix┘ └ id ┘
CSV ticket:       GOOGA26 3469041   ← the id equals the last 7 digits of the ticket number
```

The parser accepts only `<digits>:<exactly 7 digits>`. It rejects whitespace inside the code, extra separators, URLs and anything over 64 characters. The id is matched against an index of the last 7 digits of each ticket number. If no ticket matches, or more than one does, the scan is rejected and the volunteer is sent to manual lookup. The app never guesses.

**The prefix (`132774`) is not assumed to be irrelevant.** It is recorded on every scan, and you decide what to do with it on the validation screen:

| Policy | Behaviour |
| --- | --- |
| Not yet decided (default) | Recorded but not checked. **Scan claims stay disabled until the format is validated.** |
| Enforce (recommended) | Only listed prefixes are accepted, for example the Bevy event ID `132774`. |
| Ignore | Use only if you have confirmed the prefix has no meaning for matching. |

## Validate before the event (`/admin/validate`)

1. Import the real CSV first.
2. Collect **at least 5–10 real barcodes** from different orders and ticket types (organizer and volunteer tickets, and a few attendees who agree to help). Scan them with the camera on that page or a USB scanner, or type them in.
3. Click **Test against imported CSV**. Every row must show **MATCH** with the right person's name. Check this against the attendee's actual name.
4. If every prefix is the same (for example `132774`), click **Use observed prefixes**, choose **Enforce** and save.
5. Click **Mark format validated**. This stays disabled until at least 3 barcodes have been tested and all of them matched. The audit log records who validated the format and when.

If any barcode shows **NO_MATCH** or **AMBIGUOUS**, don't validate. Check the identifier length, the separator, or whether the Bevy export is up to date. You can change all of these rules on the same screen.
