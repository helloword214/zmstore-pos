# POS_Delivery_GeoAddress.md

## Purpose

Define the **delivery logic** with a focus on how we capture, snapshot, and use **addresses, landmarks, photos, and (optional) map coordinates** so riders arrive fast, tickets stay auditable, and old orders remain stable even if a customer’s saved address is edited later.

## Scope

Applies when **Channel = DELIVERY** on the **Order Pad**. No schema shown here—this is the **business guide** the schema will follow.

## Terms

- **Order Snapshot** – one-time copy of delivery details stored on the Order for printing/audit.
- **Saved Address** – a reusable `CustomerAddress` record (customer can have many).
- **Use Once Address** – ad-hoc address used for a single order (no `CustomerAddress` created).

---

## Core Delivery Logic (high level)

1. **Channel choice** happens on the **Order Pad**: `Pick-up | Delivery`.
2. If **Delivery**, a **Delivery Details** sheet opens to capture address/contact.
3. **Create & Print (Delivery)** yields a **Delivery Ticket** (not an OR).
4. **Inventory deducts** at **DISPATCHED**.
5. **Doorstep**: rider may collect payment; notes are written on the ticket/QR form.
6. **Remit** at cashier prints the correct paper:
   - **Full** → Official Receipt
   - **Partial** → Payment Acknowledgment (+ Credit Ack if not yet printed)
   - **None** (approved utang) → Credit Acknowledgment

---

## What We Capture (Order Snapshot)

These fields are **snapshotted per order** to keep printouts/audit consistent over time:

- `deliverTo` – human-readable block (name + full address)
- `deliverPhone` – contact number for rider
- `deliverLandmark` – short hint (e.g., “Blue gate, tapat ng Barangay Hall”)
- `deliverGeoLat` / `deliverGeoLng` _(optional)_ – map pin (if available)
- `deliverPhotoUrl` _(optional)_ – landmark photo for staff/rider screens (not printed)
- `deliveryAddressId` _(optional)_ – link to `CustomerAddress` if one was selected/saved

### Why snapshot?

- **Guest/Use Once** delivery has no saved address.
- **Point-in-time truth:** later edits to a saved address must **not** change old orders.
- **Fast QR to directions:** if coords exist, QR opens the exact pin; if none, it falls back to a text search.
- **Per-drop variance:** same customer, different sites—each order freezes its own details.

---

## Delivery Details – Capture Modes

### 1) Select existing (from Customer’s saved addresses)

- Snapshot name/address/phone/landmark; copy **coords** and **photo** if present; set `deliveryAddressId`.

### 2) Add new (create a new saved address, then snapshot it)

- Typical for customers adding a new drop site.

### 3) Use once (don’t save)

- Enter `deliverTo` + landmark; **phone** (required for Guest), optional **coords/photo**; **no saved address** is created.

> **Policy:** Do **not** block dispatch if coords are missing; landmark + phone is enough to proceed.

---

## Formatting Guidelines (`deliverTo`)

Include **name** first (Customer or Guest), then complete address:

Add building/unit/site identifiers when relevant.  
Keep under ~200 chars; overflow prints across lines.

**Examples**

- `Juan Dela Cruz — #12 Purok 3, Sitio Centro, Brgy Carusocan Norte, Asingan, Pangasinan`
- `ABC Sari-Sari — Km 3 MacArthur Hwy, Brgy San Vicente, Urdaneta City, Pangasinan`

---

## Landmarks vs Photos

- **Landmark (text)** – quick visual cue riders can read even without data. Always optional but encouraged.
- **Photo (optional)** – helps new riders/staff **before dispatch** (shown on PACKING/DISPATCH screen).
  - We **don’t** print photos on 57 mm (slow/blurry).
  - Optionally copy the saved address photo to the order snapshot for stability.

---

## Coordinates (Lat/Lng) – Optional Strategy

- If a saved address has **coords**, copy them to the order snapshot.
- If **Use once** or **Guest**, coords are optional at create; they can also be captured **before dispatch** or even **at remit** (for future reference).
- **Never block dispatch** for missing coords.

### Benefits

- **Exact directions** via QR deep-link.
- **Stable audit:** old tickets keep their original pin even if master data changes.
- **Heatmaps/analytics** without extra joins.

---

## Validation (Business Rules)

If **Delivery**:

- `deliverTo` is **required**.
- **Guest** deliveries require **name** (in `deliverTo`) + `deliverPhone`.
- If one of `deliverGeoLat` / `deliverGeoLng` is set, **both must be valid numbers**.

If **Add new saved address**, require:

- **Label**, **Line1**, **Barangay**, **City/Municipality**, **Province**.

**Landmark & Photo** are optional (recommended).

### Short cashier copy

- “Please enter a delivery address.”
- “Guest delivery needs a name and phone.”
- “Latitude and longitude must both be set (or leave both empty).”

---

## Printing & Links

### Delivery Ticket (57 mm)

- **Header:** Order Code, Date/Time, **DELIVERY**, Rider (if set), “Delivery Ticket — Not an Official Receipt”.
- **Address block:** `deliverTo` (multi-line) + `deliverPhone`
- **Landmark:** `deliverLandmark` (if any)
- **Maps:** link text + **QR**
  - If coords present:
    ```
    https://www.google.com/maps/dir/?api=1&destination={lat},{lng}
    ```
  - Else (fallback search):
    ```
    https://www.google.com/maps/search/?api=1&query={encoded deliverTo + " " + deliverLandmark}
    ```
- **Items & totals** (info only), **Doorstep collection** box, **LPG** box (if any)
- **Footer:** “Inventory deducts at **DISPATCHED**. Receipt prints at **Remit**.”

### Staff/Rider Screens

- **PACKING/DISPATCH:** show address, landmark, **Open in Maps** button, and **thumbnail** if a photo exists.
- **REMIT:** same info read-only for reference.

---

## Lifecycle & Editing Rules

- **Create (Delivery):** snapshot details to Order; set `fulfillmentStatus = NEW`.
- **Editability:** Channel/Address editable **until DISPATCHED**; locked after.
- **DISPATCHED:** set `dispatchedAt`; **deduct inventory**; rider leaves with Delivery Ticket.
- **DELIVERED → REMIT:** cashier encodes collections; OR/ACK prints based on payment; snapshots remain unchanged.
- **Return to Store:** if undelivered, **restore inventory**, move status back to PACKING/UNPAID; snapshots remain for audit.

---

## Edge Cases & Fallbacks

- **No signal / data:** QR search still works; rider uses landmark text + phone to call.
- **Multiple drop sites:** either create multiple saved addresses or use “Use once”; each order snapshots its own details.
- **Late coords:** may be added at remit for history; future orders can reuse via saved address.
- **Privacy:** treat photos and phone numbers as customer data; restrict who can view/edit.

---

## Acceptance Checklist

- Cannot create a Delivery order without `deliverTo` (and phone for Guest).
- Delivery Ticket QR opens **exact pin** if coords exist; otherwise a **search** for the text.
- Old orders are **unaffected** by edits to saved addresses (thanks to snapshots).
- Photos are **viewable on screens** (packing/dispatch/remit), **not printed**.
- Channel/Address **lock after DISPATCHED**; inventory always deducts once at dispatch.
- Receipts (OR/ACK) print only at **Remit**, matching totals used in AR/SOA.

---

## Future Enhancements (non-blocking)

- **Primary / lastUsedAt** on `CustomerAddress` for a smarter picker.
- **Optional QR to landmark photo** on ticket (small code, opt-in).
- **Route batching** (group deliveries by area/coords).
- **Strict geofence** (warn if rider scans outside expected radius).
