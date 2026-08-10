# Working with the SAP Developer

A guide for the portal owner, who does not write ABAP. It covers what to hand
over, what to ask for, how to accept work you cannot read, and what to refuse.

Companion documents: [`README.md`](./README.md) (how the halves fit together),
[`ABAP-SPEC.md`](./ABAP-SPEC.md) (his brief), [`openapi.yaml`](./openapi.yaml)
(the bridge developer's brief).

---

## 1. The one picture you need in your head

There are three pieces of software, not two:

```
  your portal  ──HTTPS/JSON──►  bridge service  ──RFC──►  SAP ECC
   (built)                       (to build)              (his job)
```

- **SAP** is your tenant's existing system of record. It already holds their
  customers, materials, prices, orders, invoices and receivables. Your portal
  invents none of that — it reads and writes SAP.
- **His job** is to write 41 small ABAP programs ("function modules", named
  `Z_CC_*`) that live _inside_ SAP and expose exactly the data your portal
  needs. He works in ABAP only. No web, no JSON, no HTTP.
- **The bridge** is a small Node service that calls those ABAP modules and
  turns the answers into JSON for your portal. This is the piece that speaks
  both languages, and it is **not** his job unless he happens to also be a Node
  developer.

The single most common way this engagement goes wrong is nobody being assigned
the bridge. Ask, in the first meeting: _who is building the bridge?_ If the
answer is unclear, it is you or another web developer — not him.

### Why the split is this way

He is expert in ABAP and BAPIs. Asking him to build an HTTP service means he
must first learn SICF handlers, JSON serialisation, status codes and REST
conventions — weeks of learning before he writes a line of the logic you hired
him for. Splitting at the RFC boundary lets each side work in its native idiom.
If he _offers_ to expose the modules as web services directly, that is a
legitimate alternative but it moves the freshness envelope, status translation
and error typing into ABAP. Don't accept it just to skip building the bridge.

---

## 2. What to hand him, and what not to

| give him                                                                   | why                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `ABAP-SPEC.md`                                                             | His entire brief. Structures, all 41 modules, testing, build order. |
| Read access to a **sandbox/dev SAP client**                                | He cannot develop against production.                               |
| The sales org / distribution channel / division the portal transacts under | Every sales document needs them.                                    |

**Do not** send him `openapi.yaml` or the portal repo. Both are written in web
terms and will only add noise. If he asks what a response "should look like",
the answer is in his own spec's DDIC structures — not in TypeScript.

---

## 3. The first meeting — a 45-minute agenda

Run it in this order. Do not let it become a general architecture debate.

1. **Frame the work (5 min).** "Portal is built and running against a simulator.
   I need the real SAP behind it. Here is the specification — 41 RFC function
   modules. Please read section 2 first; it is the conventions that apply to all
   of them."
2. **Confirm the split (5 min).** Show him the diagram above. Confirm he is
   writing ABAP RFCs only, and confirm who owns the bridge.
3. **Agree Milestone 0 (5 min).** Two modules only: `Z_CC_PING` and
   `Z_CC_CUST_GET`. Nothing else starts until those two work end to end.
4. **The four conventions that are non-negotiable (15 min).** Walk him through
   §2.3, §2.4, §2.6 and §2.7 of his spec — see section 5 below for what these
   are and why. Everything else in the spec he will recognise; these four are
   where an experienced ABAP developer will "helpfully" do the wrong thing.
5. **Environment and access (10 min).** Get him to name what he needs from
   Basis, and get the connection details you need (section 4).
6. **Cadence (5 min).** Weekly demo in SE37, milestone-based acceptance.

---

## 4. What to get from the Basis team

You need these before the bridge can connect. Ask his Basis colleague, in
writing:

- **Application server host** and **system number** (e.g. `sapdev.acme.local`,
  `00`)
- **Client** number for the sandbox (e.g. `100`)
- **System ID** (three letters, e.g. `DEV`)
- A **service user** of type `Communications Data` with authorisation to call
  the `Z_CC_*` function group over RFC — _not_ a named human's account, and not
  a dialog user.
- Confirmation that **port 33`<sysnr>`** (e.g. 3300) is reachable from wherever
  the bridge will run.
- The **SAP NetWeaver RFC SDK** download (it sits behind an SAP support login
  their team has and you probably don't).

Also agree in writing: **the portal never touches production SAP until the
tenant signs off.** Sandbox for the whole build.

---

## 5. The four rules you must personally police

These are the ones where he will be tempted to be helpful, and where being
helpful breaks your portal. You do not need ABAP to enforce them — you just
need to ask the question.

### 5.1 Return raw SAP codes, not friendly words (spec §2.3)

He must return `GBSTK = 'B'`, not `"Partially Delivered"`. Your portal already
owns the translation (`packages/domain/src/status.ts`) and uses it in about
forty places. If ABAP translates too, you get two vocabularies that drift apart
and disagree on screen.

**Ask:** "Does any module return an English status word?" The answer must be no.

### 5.2 Writes must be idempotent (spec §2.4)

If the bridge sends "create this order" and the network dies before the answer
comes back, the bridge will retry. Without protection you get two orders and a
furious customer. The spec's fix is a small table (`ZCC_IDEMPOTENCY`) keyed on a
reference the caller supplies: seen it before, return the original document
number instead of creating a second one.

This is the one genuinely new thing in his brief and the one most likely to be
skipped as "we'll add it later". It is not optional.

**Ask:** "Show me what happens when I call `Z_CC_SO_CREATE` twice with the same
`IV_REFERENCE`." Correct answer: the same VBELN both times, one order in VA03.

### 5.3 Customer reads and tenant-wide reads are different modules (spec §2.6)

Some reads are "this one customer's orders" (`Z_CC_SO_LIST`). Some are "every
order in the company" for the back-office desks (`Z_CC_SO_CREDIT_QUEUE`). They
must stay **separate modules**, never one module with an optional customer
parameter.

Reason: if it's one module and any caller ever forgets to pass the customer
number, a customer sees every other customer's data. A boundary that depends on
remembering an argument is not a boundary. Your portal is built the same way
(ADR-032).

**Ask:** "Is there any module where leaving a parameter empty returns everyone's
data?" The answer must be no.

### 5.4 Never calculate tax, never change a credit limit (spec §2.7, §2.8)

GST comes off SAP's own pricing conditions (KONV) exactly as SAP computed it.
Nobody — not ABAP, not the bridge, not the portal — recomputes it. A second
calculation of tax is a second answer, and one of them is wrong on an invoice
that goes to a tax authority.

Same shape of rule for credit limits: the portal records a _request_ for an
increase and a _decision_ about it. Raising the actual limit is FD32, done by a
human in SAP. No module writes `KNKK-KLIMK`.

**Ask:** "Does any module compute a tax amount or write a credit limit?" No.

---

## 6. Build order and how to accept each stage

His spec ends with the build order. Insist on it — do not let him work on
whatever is interesting. Each milestone is accepted before the next starts.

| milestone                            | what it proves                             |
| ------------------------------------ | ------------------------------------------ |
| **0 — `Z_CC_PING`, `Z_CC_CUST_GET`** | The connection works at all.               |
| **1 — customer master (8)**          | Reads and writes against real master data. |
| **2 — catalogue (4)**                | Materials, stock, customer-specific price. |
| **3 — sales orders (7)**             | The money path.                            |
| **4 — pre-sales (9)**                | Inquiry and quotation.                     |
| **5 — delivery, billing, AR (12)**   | The rest of order-to-cash.                 |

**Milestone 0 is worth more than it looks.** Wrong host, blocked port, missing
authorisation, wrong client, service user without RFC rights — nearly every
integration failure in this kind of project surfaces on the first successful
round trip. Finding them with two modules on the table is a different afternoon
from finding them with forty-one.

### Accepting work you cannot read

You do not need to read ABAP to accept a module. Three checks:

1. **Watch him run it in SE37.** SE37 is SAP's test screen: he types input
   values, presses F8, and the output structure fills in. Ask him to do this
   for each module, on screen share. You are watching that the output fields
   are populated and the names match the spec's structures.
2. **Cross-check against your mock.** `packages/adapters/sap/src/mock/driver.ts`
   is a complete, working implementation of all 41 operations. It is your
   reference for what a correct answer looks like. If his `Z_CC_CUST_GET`
   returns no GSTIN and your mock returns one, one of you is wrong — find out
   which before moving on.
3. **Once the bridge exists, run the portal against it.** This is the real
   acceptance test and it is the whole reason the mock exists: switching a
   tenant from `mock` to `ecc` is a configuration change in the ops console, not
   a code change. The screen either renders correctly or it doesn't.

Ask for his **transport request numbers** at each milestone (these are how ABAP
code moves between SAP systems). You want a list of them at handover so the
tenant's Basis team can move the work to production later.

---

## 7. What "done" looks like at handover

From his spec §6, but worth holding him to explicitly:

- All 41 `Z_CC_*` function modules, RFC-enabled, in one function group.
- The DDIC structures they use.
- The `ZCC_IDEMPOTENCY` table.
- Transport request numbers.
- A short note per module of any deviation from the spec — every deviation is
  something your bridge must handle, and an undocumented one becomes a bug you
  debug six weeks later.

---

## 8. Things you should expect him to push back on, fairly

Not everything he questions is him cutting corners. These are legitimate:

- **"Your spec assumes a field that this tenant doesn't populate."** Real ECC
  installs vary. Genuine finding — record it, decide together whether the portal
  degrades gracefully or the tenant fills the field.
- **"This customer master has custom Z-fields for GSTIN."** Very common in
  Indian ECC installs. He should tell you where it actually lives; your spec's
  structure names then need updating, not his code.
- **"That BAPI needs a commit and I can't do it in this module."** Legitimate
  ABAP mechanics. Trust him.
- **"Pricing simulation is expensive at this volume."** Worth a real
  conversation about caching in the bridge.

What is _not_ legitimate: "we can add idempotency later", "let me just return
the status as text since that's easier to read", "one module can do both the
customer list and the full list".

---

## 9. Working cadence

- **Weekly**, 30 minutes: he demos in SE37 whatever he finished. You check
  against the mock. No slide decks.
- **Between meetings**, keep building the portal against `mock` — you are never
  blocked on him, which is the entire point of having built it mock-first.
- **Keep a running list** of every deviation and every question, in this folder.
  A decision made verbally and not written down is a decision that gets made
  again differently in two months.

---

## 10. Vocabulary, so meetings go faster

| he says         | it means                                                            |
| --------------- | ------------------------------------------------------------------- |
| **BAPI**        | SAP's own official API function for a business operation.           |
| **RFC**         | The protocol for calling a function inside SAP from outside.        |
| **SE37**        | The screen where you test a function module by hand.                |
| **SE11**        | Where data structures and tables are defined.                       |
| **DDIC**        | The data dictionary — SAP's catalogue of those structures.          |
| **Transport**   | The package that moves code between SAP systems.                    |
| **Client**      | An isolated dataset inside one SAP system (like a tenant).          |
| **Basis**       | The team that runs the SAP servers, users and connections.          |
| **KUNNR**       | Customer number. The security boundary in your whole portal.        |
| **VBELN**       | Sales document number (order, delivery, invoice — context decides). |
| **MATNR**       | Material (product) number.                                          |
| **BAPIRET2**    | SAP's standard "here is what went wrong" structure.                 |
| **VA01 / VA03** | Create / display a sales order, by hand in SAP.                     |
| **FD32**        | Where a human maintains a customer's credit limit.                  |
