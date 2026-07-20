<script setup>
// The signed-in user's application library — the apps authentik says they can
// launch, mirroring authentik's own user view. Data comes straight from
// authentik's /core/applications/ via useApplications(). Rendered inside the
// account shell (layout: 'account'), so no outer panel here.
definePageMeta({ middleware: 'auth', layout: 'account' })

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
  <div>
    <TabHeader title="Your applications" subtitle="Apps you can access with your IETF account." />

    <div
      v-if="usingSample"
      class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700"
    >
      Showing sample applications (dev) — no live authentik session.
    </div>

    <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ error }}
    </div>

    <LoadingState v-else-if="loading" text="Loading your applications…" />

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
        <div class="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-[0_2px_5px_-1px_rgb(15_23_42_/_0.1)] divide-y divide-slate-100">
          <a
            v-for="app in section.apps"
            :key="app.pk"
            :href="app.launchUrl"
            :target="app.openInNewTab ? '_blank' : '_self'"
            rel="noopener"
            class="group flex items-center gap-3 px-4 py-3 transition hover:bg-white"
          >
            <img
              v-if="app.icon"
              :src="app.icon"
              alt=""
              class="h-9 w-9 shrink-0 rounded-lg object-contain"
            />
            <span
              v-else
              aria-hidden="true"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100
                text-base font-semibold text-sky-700"
            >
              {{ app.name.charAt(0).toUpperCase() }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-slate-900 group-hover:text-sky-700">
                {{ app.name }}
              </span>
              <span
                v-if="app.description"
                :title="app.description"
                class="block truncate text-xs text-slate-500"
              >
                {{ app.description }}
              </span>
            </span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              class="h-4 w-4 shrink-0 text-slate-300 group-hover:text-sky-400"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </a>
        </div>
      </section>
    </div>
  </div>
</template>
