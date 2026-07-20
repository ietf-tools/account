<script setup>
// The signed-in user's application library — the apps authentik says they can
// launch, mirroring authentik's own user view. Data comes straight from
// authentik's /core/applications/ via useApplications().
definePageMeta({ middleware: 'auth', layout: 'wide' })

const auth = useAuthStore()
const { apps, loading, error, usingSample, load } = useApplications()

// Section the apps by their authentik `group`, the way authentik's library does.
// Ungrouped apps ('') fall into a trailing "Other" section; named groups sort
// alphabetically above it.
const sections = computed(() => {
  const byGroup = new Map()
  for (const app of apps.value) {
    const key = app.group || ''
    if (!byGroup.has(key)) {
      byGroup.set(key, [])
    }
    byGroup.get(key).push(app)
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => {
      if (a === '') {
        return 1
      }
      if (b === '') {
        return -1
      }
      return a.localeCompare(b)
    })
    .map(([name, items]) => ({ name, apps: items }))
})

// Whether to bother printing a group heading: only when there's more than one
// section (a single unnamed group would just be noise).
const showHeadings = computed(() => sections.value.length > 1)

onMounted(load)
</script>

<template>
  <div class="rounded-2xl bg-white p-6 shadow-xl outline outline-[6px] outline-sky-400/40 sm:p-8">
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Your applications</h1>
        <p class="mt-1 text-sm text-slate-500">
          Apps you can access with your IETF account.
        </p>
      </div>
      <NuxtLink
        to="/"
        class="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300
          bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition
          hover:bg-slate-50"
      >
        Account
      </NuxtLink>
    </div>

    <div
      v-if="usingSample"
      class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700"
    >
      Showing sample applications (dev) — no live authentik session.
    </div>

    <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ error }}
    </div>

    <div v-else-if="loading" class="py-10 text-center text-sm text-slate-500">
      Loading your applications…
    </div>

    <div v-else-if="apps.length === 0" class="py-10 text-center text-sm text-slate-500">
      You don't have access to any applications yet.
    </div>

    <div v-else class="space-y-8">
      <section v-for="section in sections" :key="section.name || 'other'">
        <h2
          v-if="showHeadings"
          class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400"
        >
          {{ section.name || 'Other' }}
        </h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <a
            v-for="app in section.apps"
            :key="app.pk"
            :href="app.launchUrl"
            :target="app.openInNewTab ? '_blank' : '_self'"
            rel="noopener"
            class="group flex items-start gap-3 rounded-xl border border-slate-200 bg-gradient-to-b
              from-white to-slate-50 p-4 shadow-sm ring-1 ring-inset ring-white transition
              hover:border-sky-300 hover:to-white hover:shadow-md"
          >
            <img
              v-if="app.icon"
              :src="app.icon"
              alt=""
              class="h-14 w-14 shrink-0 rounded-lg object-contain"
            />
            <span
              v-else
              aria-hidden="true"
              class="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-sky-100
                text-2xl font-semibold text-sky-700"
            >
              {{ app.name.charAt(0).toUpperCase() }}
            </span>
            <span class="min-w-0">
              <span class="block truncate font-medium text-slate-900 group-hover:text-sky-700">
                {{ app.name }}
              </span>
              <span v-if="app.description" class="mt-0.5 block text-xs text-slate-500 line-clamp-2">
                {{ app.description }}
              </span>
            </span>
          </a>
        </div>
      </section>
    </div>
  </div>
</template>
