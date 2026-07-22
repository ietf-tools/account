# IETF authentik email templates

Custom [authentik Email-stage](https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/email/)
templates that replace the stock authentik emails with IETF-branded ones:

| File | Used by | authentik flow / stage |
| --- | --- | --- |
| [`ietf_account_confirmation.html`](ietf_account_confirmation.html) | Account-creation email verification | `ietf-enrollment` → Email stage `ietf-enrollment-emailverify` |
| [`ietf_password_reset.html`](ietf_password_reset.html) | Password reset | `ietf-recovery` → Email stage `ietf-recovery-email-verification-stage` |
| [`ietf_email_change.html`](ietf_email_change.html) | Email-change verification (sent to the new address) | `ietf-email-change` → Email stage `ietf-email-change-email` |

They are standalone (they don't `{% extends %}` authentik's base template), so the
look is fully self-contained and email-client-safe (table layout, inline styles).
authentik renders them with three context variables: **`url`** (the action link,
carrying the flow token), **`user`** (the pending user), and **`expires`** (token
expiry — used via the `|timeuntil` filter).

> **Both the `server` and `worker` pods need these files.** The **server** scans
> `/templates` to populate the "Template" dropdown in the stage editor; the
> **worker** actually renders and sends the email. Mount the ConfigMap into both.

## Deploy (Helm on Kubernetes)

Set `NS` to your authentik namespace first (examples assume `authentik`).

### 1. Create/refresh the ConfigMap from these files

```bash
NS=authentik
kubectl -n "$NS" create configmap authentik-email-templates \
  --from-file=ietf_account_confirmation.html=ietf_account_confirmation.html \
  --from-file=ietf_password_reset.html=ietf_password_reset.html \
  --from-file=ietf_email_change.html=ietf_email_change.html \
  --dry-run=client -o yaml | kubectl apply -f -
```

Re-run this exact command whenever you edit a template — it updates the ConfigMap
in place. (ConfigMap keys can't contain `/`, so keep the templates flat here; they
land directly in `/templates/`, which is fine.)

### 2. Mount it at `/templates` in the Helm values

In your authentik `values.yaml`, add the volume and mount. In the official
authentik chart these top-level keys apply to **both** the server and worker
deployments:

```yaml
volumes:
  - name: email-templates
    configMap:
      name: authentik-email-templates
volumeMounts:
  - name: email-templates
    mountPath: /templates
    readOnly: true
```

Then apply:

```bash
helm upgrade authentik authentik/authentik -n "$NS" -f values.yaml
```

> If your chart version scopes volumes per-component instead of top-level, set the
> same `volumes`/`volumeMounts` under **both** `server:` and `worker:`. Confirm
> against your chart's `values.yaml` schema.

### 3. Select the templates on each Email stage

In the authentik admin interface: **Flows & Stages → Stages**, then for each stage
in the table above, **Edit** it and:

- Set **Template** to the matching file (it appears in the dropdown once the pods
  have restarted with the mount — see step 4).
- Set **Subject** here too — the subject line lives on the stage, **not** in the
  template. Suggested:
  - Enrollment: `Confirm your IETF account email address`
  - Recovery: `Reset your IETF account password`
  - Email change: `Confirm your new IETF account email address`

### 4. Restart and verify

The template dropdown is populated at process start, so restart after mounting or
after adding a new template file:

```bash
kubectl -n "$NS" rollout restart deployment -l app.kubernetes.io/name=authentik
# or target them explicitly, e.g.:
# kubectl -n "$NS" rollout restart deployment/authentik-server deployment/authentik-worker
```

Then test end-to-end (register a throwaway account; trigger a password reset) and
check the received email. If a template doesn't appear or doesn't render, check the
**worker** logs — authentik logs template-discovery and render errors there.

## Email-change flow (`ietf-email-change`) — extra wiring

Unlike enrollment/recovery (where selecting the template is all that's needed on the
authentik side), the change-email flow needs three additional things, because it
sends the verification email to an address the user just typed and must apply the
change only after they confirm it:

1. **Send to the new address.** An expression policy on the Email stage
   (`ietf-email-change-email`) redirects the recipient to the entered address by
   mutating the in-memory pending user before the stage runs:

   ```python
   new_email = request.context.get("prompt_data", {}).get("email")
   if not new_email:
       return False
   pending_user = request.context.get("pending_user")
   if pending_user:
       pending_user.email = new_email      # in memory only — not saved yet
   request.context["prompt_data"]["username"] = new_email  # keep username == email
   return True
   ```

   Bind it to the Email stage's **FlowStageBinding** with **Evaluate on plan = OFF**
   and **Re-evaluate policies = ON** — otherwise it runs before `prompt_data` exists
   and silently sends to the *old* address.

2. **Cloudflare Rule 10.** The verification link points at
   `/if/flow/ietf-email-change/?<token>`; Rule 10 must route that to
   `/app/verify-email-change` (preserving the querystring) so the app drives the
   confirmation. See the main [README.md](../../README.md) "Edge routing" table.

3. **⚠️ Verify the pre-fetch guard before going live.** The change must NOT be
   applied on a bare GET of the link — otherwise a mail scanner (Outlook / Microsoft
   Defender Safe Links) that pre-fetches it would confirm the change on the user's
   behalf. The protection relies on authentik injecting an interactive
   `ak-stage-consent` when the flow is **resumed from the email token**, so
   `user_write` runs only after the user's explicit POST. **Confirm this actually
   happens for this flow:**

   - Trigger a change, then open the link and check that you land on a "confirm to
     proceed" step **before** the address is written — the new email should NOT yet
     be in effect at that point.
   - Or reproduce a scanner: `curl -sL "<the link from the email>"` (a plain GET,
     no JS) and verify afterwards that the address is **unchanged**.

   If the flow instead resumes straight onto `user_write` (no consent), add an
   explicit **Consent** (or a confirmation **Prompt**) stage in the flow *after* the
   Email stage so a real interactive POST is always required. `verify-email-change.vue`
   already renders `ak-stage-consent` (and any prompt) via `FlowExecutor`.

## Editing notes

- **Content changes** require re-running step 1 **and** restarting the worker
  (step 4): mounted ConfigMaps sync lazily and authentik caches templates.
- Preview the raw HTML locally by opening the file in a browser — the `{{ url }}`,
  `{{ user }}` and `{% if expires %}` bits render literally until authentik fills
  them in, which is expected.
- **Logo:** the header uses PNGs served from `static.ietf.org` —
  `ietf-email-logo.png` (light) and `ietf-email-logo-inverted.png` (dark mode),
  both 420×240 shown at 140×80. They render in every client (unlike SVG).
- **Dark mode:** a `prefers-color-scheme: dark` block in each file's `<head>` swaps
  to the inverted logo and darkens the card/text. Only clients that support it
  (Apple Mail, iOS Mail) go dark; Gmail and Outlook ignore the `<style>` block and
  stay on the light inline styles. If you change the layout, remember the inline
  styles are the light default and the `<style>` rules (with `!important`) are the
  dark overrides — keyed by the `email-*`/`logo-*` classes.

## GitOps alternative

If you manage the chart declaratively and don't want an out-of-band `kubectl create
configmap`, render the ConfigMap from these files into your own manifests (e.g. a
Kustomize `configMapGenerator`, or the chart's `extraObjects`) instead of step 1.
Baking the templates into a custom authentik image also works but couples template
edits to image rebuilds — the ConfigMap mount is lighter.
