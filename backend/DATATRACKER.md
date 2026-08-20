# Datatracker-specific Endpoints

The following endpoints are for Datatracker sync operations with Authentik.

## Authentication

Datatracker must send a valid API key via the `X-Api-Key` header.

## User Endpoints

### POST `/api/datatracker/users/link`

Link an authentik user by primary email address with Datatracker UUID / Sub for the first time.

#### Body
```json
{
  "email": "primary-email@example.com",
  "person_uuid": "69118e17-2787-476a-82dc-0659192fd65f",
  "sub": "12345"
}
```

#### Implementation
1. Find the Authentik user based on the primary email provided (`email` field).
2. Update the user attributes to add the following properties:
    ```json
    "datatracker": {
      "person_uuid": "69118e17-2787-476a-82dc-0659192fd65f",
      "prior_uuids": [],
      "legacy_sub": "12345",
      "linked_at": "2026-07-29T12:00:00Z",
      "updated_at": "2026-07-29T12:00:00Z"
    },
    "upn": "12345"
    ```

#### Response
HTTP 204



### PATCH - `/api/datatracker/users/:person_uuid`

Patch the `datatracker` user attributes object for a user matching the person UUID.

#### Body
```json
{
  "person_uuid": "69118e17-2787-476a-82dc-0659192fd65f",
  "prior_uuids": [],
  "legacy_sub": "12345"
}
```

#### Implementation
1. Find the Authentik user whose attribute `datatracker.person_uuid` matches the `uuid` path parameter.
2. Update the `datatracker` user attributes field with the provided body (keeping the existing `linked_at` value and setting `updated_at` with the current timestamp).

#### Response
HTTP 204



### POST `/api/datatracker/users/assign-role`

Assign a role to a user

#### Body
```json
{
  "person_uuid": "69118e17-2787-476a-82dc-0659192fd65f",
  "role": "chair",
  "group": "tools"
}
```

#### Implementation
1. Find the Authentik user whose attribute `datatracker.person_uuid` matches the `person_uuid` field.
2. Add the user to the `dt:<role>@<group>` Authentik group. (e.g. `dt:chair@tools`)

#### Response
HTTP 204



### POST `/api/datatracker/users/unassign-role`

Unassign a role from a user

#### Body
```json
{
  "uuid": "69118e17-2787-476a-82dc-0659192fd65f",
  "role": "chair",
  "group": "tools"
}
```

#### Implementation
1. Find the Authentik user whose attribute `datatracker.person_uuid` matches the `person_uuid` field.
2. Remove the user from the `dt:<role>@<group>` Authentik group. (e.g. `dt:chair@tools`)

#### Response
HTTP 204



### POST `/api/datatracker/users/assign-dot`

Assign a dot to a user

**Body:**
```json
{
  "uuid": "69118e17-2787-476a-82dc-0659192fd65f",
  "dot": "chair"
}
```

#### Implementation
1. Find the Authentik user whose attribute `datatracker.person_uuid` matches the `person_uuid` field.
2. Add the user to the `dt:dot:<dot>` Authentik group. (e.g. `dt:dot:chair`)

#### Response
HTTP 204



### POST `/api/datatracker/users/unassign-dot`

Unassign a dot from a user

#### Body
```json
{
  "uuid": "69118e17-2787-476a-82dc-0659192fd65f",
  "dot": "chair"
}
```

#### Implementation
1. Find the Authentik user whose attribute `datatracker.person_uuid` matches the `person_uuid` field.
2. Remove the user from the `dt:dot:<dot>` Authentik group. (e.g. `dt:dot:chair`)

#### Response
HTTP 204



## Roles Endpoints

### POST - `/api/datatracker/roles`

Create a new Authentik group for a Datatracker (role, group) pair.

#### Body
```json
{
  "role": "chair",
  "group": "tools"
}
```

#### Implementation
1. Ensure the `dt:role:<role>` Authentik group exists. Create it otherwise.
2. Ensure the `dt:group:<group>` Authentik group exists. Create it otherwise.
3. Create a new Authentik group named `dt:<role>@<group>` (e.g. `dt:chair@tools`)
4. Add the following attributes to the group *(replacing the `<role>` and `<group>` values)*:
    ```json
    { "datatracker": { "role": "<role>", "group": "<group>", "group_type": "team" } }
    ```
5. Set both `dt:role:<role>` and `dt:group:<group>` groups as parents.

#### Response
HTTP 204



### PATCH - `/api/datatracker/roles/:role/:group`

Rename a Datatracker (role, group) pair Authentik group.

#### Body
```json
{
  "new_role": "chair2",
  "new_group": "tools2"
}
```

#### Implementation
1. Rename the Authentik group named `dt:<role>@<group>` to `dt:<new_role>@<new_group>`
2. Update the group attributes with *(replacing the `<rnew_ole>` and `<new_group>` values)*:
    ```json
    { "datatracker": { "role": "<new_role>", "group": "<new_group>", "group_type": "team" } }
    ```

#### Response
HTTP 204



### DELETE - `/api/datatracker/roles/:role/:group`

Delete a Datatracker (role, group) pair Authentik group.

#### Body
```json
{
  "role": "chair",
  "group": "tools"
}
```

#### Implementation
1. Delete the Authentik group named `dt:<role>@<group>`

#### Response
HTTP 204



## Dots Endpoints

### POST - `/api/datatracker/dots`

Create a new Authentik group for a Datatracker dot.

#### Body
```json
{
  "dot": "chair"
}
```

#### Implementation
1. Create a new Authentik group named `dt:dot:<dot>` (e.g. `dt:dot:chair`)

#### Response
HTTP 204



### PATCH - `/api/datatracker/dots/:dot`

Rename a Datatracker dot Authentik group.

#### Body
```json
{
  "new_dot": "chair2"
}
```

#### Implementation
1. Rename the Authentik group named `dt:dot:<dot>` to `dt:dot:<new_dot>`

#### Response
HTTP 204



### DELETE - `/api/datatracker/dots/:dot`

Delete a Datatracker dot Authentik group.

#### Implementation
1. Delete the Authentik group named `dt:dot:<dot>`

#### Response
HTTP 204