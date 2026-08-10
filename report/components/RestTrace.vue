<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({ src: String, accent: { type: String, default: '#52d3ff' } })
const trace = ref({ title: 'Loading trace...', result: '', events: [] })
const index = ref(-1), playing = ref(false), speed = ref(850)
let timer

onMounted(async () => {
  const url = new URL(props.src.replace(/^\/+/, ''), document.baseURI)
  trace.value = await (await fetch(url)).json()
})
onUnmounted(() => clearInterval(timer))
watch(playing, active => {
  clearInterval(timer)
  if (active) timer = setInterval(() => {
    if (index.value >= trace.value.events.length - 1) playing.value = false
    else index.value++
  }, speed.value)
})
watch(speed, () => { if (playing.value) { playing.value = false; setTimeout(() => playing.value = true, 0) } })

const current = computed(() => trace.value.events[index.value] || { owner:'ready', name:'Ready', note:'Press play or step through the HTTP trace' })
const state = computed(() => {
  const s = { token:0, session:0, sessionEpoch:null, chunks:[], pending:'', committed:false, failed:false }
  for (let i=0; i<=index.value; i++) {
    const e = trace.value.events[i], n = e?.name || ''
    if (e.owner === 'client') s.pending = n
    if (n === '201 Created (session)') { s.session++; s.sessionEpoch=s.token; s.chunks=[] }
    if (n === '200 OK (token refreshed)') s.token++
    if (n === '204 No Content') {
      if (s.pending.endsWith('/1') && !s.chunks.includes(1)) s.chunks.push(1)
      if (s.pending.endsWith('/2') && !s.chunks.includes(2)) s.chunks.push(2)
    }
    if (n === '409 Invalid Session') s.failed=true
    if (n === '201 Created (backup committed)') s.committed=true
  }
  s.valid = s.session > 0 && s.sessionEpoch === s.token
  return s
})
function restart(){ index.value=-1; playing.value=false }
function step(){ if(index.value < trace.value.events.length-1) index.value++ }
</script>

<template>
  <div class="rest-trace" :style="{'--accent':accent}">
    <div class="rest-state">
      <div class="endpoint"><span>CLIENT</span><b>backup-controller</b></div>
      <div class="wire"><i></i><small>{{ current.owner === 'client' ? 'REQUEST →' : current.owner === 'server' ? '← RESPONSE' : 'HTTP' }}</small></div>
      <div class="endpoint server"><span>SERVER</span><b>backup REST API</b></div>
      <div class="cards">
        <div><small>TOKEN</small><b>T{{ state.token }}</b></div>
        <div :class="{invalid:state.session && !state.valid}"><small>SESSION</small><b>{{ state.session ? 'S'+state.session : '—' }}</b><em>{{ state.session ? (state.valid ? 'valid' : 'invalid') : 'none' }}</em></div>
        <div><small>CHUNKS</small><b>{{ state.chunks.length }}/2</b><em>{{ state.chunks.join(', ') || 'none' }}</em></div>
      </div>
      <div v-if="state.failed" class="verdict bad">409 · INVALID SESSION</div>
      <div v-if="state.committed" class="verdict good">201 · BACKUP COMMITTED</div>
    </div>
    <div class="trace-info">
      <div class="trace-title">{{ trace.title }}</div>
      <div class="event-owner">{{ current.owner }}</div>
      <div class="event-name">{{ current.name }}</div>
      <div class="event-note">{{ current.note }}</div>
      <div class="progress"><span :style="{width:((index+1)/Math.max(trace.events.length,1)*100)+'%'}"></span></div>
      <div class="controls"><button @click="restart">↺</button><button @click="playing=!playing">{{ playing ? 'Ⅱ' : '▶' }}</button><button @click="step">→</button><select v-model="speed"><option :value="1300">0.7×</option><option :value="850">1×</option><option :value="450">1.8×</option></select><em>{{ Math.max(index+1,0) }} / {{ trace.events.length }}</em></div>
    </div>
  </div>
</template>

<style scoped>
.rest-trace{display:grid;grid-template-columns:1.2fr 1fr;gap:1.4rem;height:365px;background:rgba(5,10,18,.58);border-top:4px solid var(--accent);padding:1.15rem}.rest-state{position:relative;display:grid;grid-template-columns:1fr .55fr 1fr;grid-template-rows:100px 1fr;gap:.7rem}.endpoint{border:1px solid #31445f;background:#0e1929;display:flex;flex-direction:column;justify-content:center;padding:1rem}.endpoint span{font-size:.58rem;letter-spacing:.14em;color:var(--accent)}.endpoint b{margin-top:.5rem}.server span{color:#ff8b8b}.wire{display:grid;place-items:center;position:relative;color:#91a2bd}.wire i{height:1px;background:#4a607e;width:100%;position:absolute}.wire small{z-index:1;background:#09111f;padding:.25rem;font-size:.55rem}.cards{grid-column:1/4;display:grid;grid-template-columns:repeat(3,1fr);gap:.65rem}.cards>div{border:1px solid #31445f;background:#0b1523;padding:.8rem}.cards small{display:block;color:#8293ac;font-size:.55rem;letter-spacing:.12em}.cards b{display:block;font-size:1.5rem;margin-top:.35rem}.cards em{font-size:.62rem;color:#37d67a}.cards .invalid{border-color:#ff6b6b}.cards .invalid em{color:#ff6b6b}.verdict{position:absolute;inset:auto 0 0;z-index:2;text-align:center;padding:.65rem;font-weight:900;letter-spacing:.08em}.bad{background:#5a1824;color:#ff9aa7}.good{background:#123f2a;color:#71eca3}.trace-info{display:flex;flex-direction:column;min-width:0}.trace-title{font-size:.7rem;color:#91a2bd}.event-owner{text-transform:uppercase;color:var(--accent);font-size:.6rem;letter-spacing:.15em;margin-top:1.5rem}.event-name{font-family:monospace;font-size:1.18rem;font-weight:800;margin-top:.4rem;overflow-wrap:anywhere}.event-note{color:#a8b7cc;line-height:1.35;margin-top:.7rem;min-height:3rem}.progress{height:4px;background:#28384f;margin-top:auto}.progress span{display:block;height:100%;background:var(--accent);transition:width .25s}.controls{display:flex;align-items:center;gap:.45rem;margin-top:.7rem}.controls button,.controls select{background:#17263c;color:#edf5ff;border:1px solid #3a4d68;padding:.3rem .6rem}.controls em{margin-left:auto;color:#71839e;font-size:.65rem}
</style>
