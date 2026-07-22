# IETF authentik email templates

Custom [authentik Email-stage](https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/email/)
templates that replace the stock authentik emails with IETF-branded ones:

| File | Used by | authentik flow / stage |
| --- | --- | --- |
| [`ietf_account_confirmation.html`](ietf_account_confirmation.html) | Account-creation email verification | `ietf-enrollment` → Email stage `ietf-enrollment-emailverify` |
| [`ietf_password_reset.html`](ietf_password_reset.html) | Password reset | `ietf-recovery` → Email stage `ietf-recovery-email-verification-stage` |

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
