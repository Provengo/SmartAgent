<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({ src: String, accent: { type: String, default: '#52d3ff' } })
const trace = ref({ title: 'Loading trace…', result: '', events: [] })
const index = ref(-1)
const playing = ref(false)
const speed = ref(900)
let timer

onMounted(async () => {
  const traceUrl = new URL(props.src.replace(/^\/+/, ''), document.baseURI)
  trace.value = await (await fetch(traceUrl)).json()
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

const current = computed(() => trace.value.events[index.value] || { owner:'ready', name:'Ready', note:'Press play or step through the trace' })
const state = computed(() => {
  const s = { robot:'STAGING', permit:null, denied:false, delivered:false, failure:false }
  for (let i=0; i<=index.value; i++) {
    const n = trace.value.events[i]?.name || ''
    if (n.startsWith('Deny')) s.denied = true
    if (n.startsWith('Grant')) s.permit = 'NORTH'
    if (n.startsWith('Enter')) s.robot = 'NORTH_ENTRANCE'
    if (n.startsWith('Advance')) s.robot = 'NORTH_FAR'
    if (n.startsWith('Exit')) { s.robot = 'GOAL'; s.permit = null }
    if (n === 'Deliver') s.delivered = true
    if (n.includes('FAILURE')) s.failure = true
  }
  return s
})
function restart(){ index.value=-1; playing.value=false }
function step(){ if(index.value < trace.value.events.length-1) index.value++ }
</script>

<template>
  <div class="trace-shell" :style="{'--accent': accent}">
    <div class="warehouse">
      <div class="zone staging" :class="{occupied:state.robot==='STAGING'}"><small>STAGING</small><span v-if="state.robot==='STAGING'">●</span></div>
      <div class="corridor north"><small>NORTH</small><span v-if="state.robot==='NORTH_ENTRANCE'" class="robot entrance">●</span><span v-if="state.robot==='NORTH_FAR'" class="robot far">●</span><i v-if="state.permit">PERMIT</i></div>
      <div class="corridor south"><small>SOUTH</small></div>
      <div class="zone goal" :class="{occupied:state.robot==='GOAL'}"><small>GOAL</small><span v-if="state.robot==='GOAL'">●</span><b v-if="state.delivered">DELIVERED</b></div>
      <div v-if="state.failure" class="failure-flash">!</div>
    </div>
    <div class="trace-info">
      <div class="trace-title">{{ trace.title }}</div>
      <div class="event-owner">{{ current.owner }}</div>
      <div class="event-name">{{ current.name }}</div>
      <div class="event-note">{{ current.note }}</div>
      <div class="progress"><span :style="{width: ((index+1)/Math.max(trace.events.length,1)*100)+'%'}"></span></div>
      <div class="controls">
        <button @click="restart">↺</button><button @click="playing=!playing">{{ playing ? 'Ⅱ' : '▶' }}</button><button @click="step">→</button>
        <select v-model="speed"><option :value="1400">0.7×</option><option :value="900">1×</option><option :value="500">1.8×</option></select>
        <em>{{ Math.max(index+1,0) }} / {{ trace.events.length }}</em>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trace-shell{display:grid;grid-template-columns:1.35fr 1fr;gap:1.5rem;height:360px;background:rgba(5,10,18,.55);border-top:4px solid var(--accent);padding:1.25rem}
.warehouse{position:relative;display:grid;grid-template-columns:1fr 2.4fr 1fr;grid-template-rows:1fr 1fr;gap:.65rem}
.zone,.corridor{position:relative;border:1px solid #31445f;background:#0e1929;color:#8395b1;display:flex;align-items:center;justify-content:center;overflow:hidden}
.staging{grid-row:1/3}.goal{grid-column:3;grid-row:1/3}.north{grid-column:2;grid-row:1}.south{grid-column:2;grid-row:2}
small{position:absolute;top:.45rem;left:.55rem;font-size:.58rem;letter-spacing:.12em}.zone span,.robot{color:var(--accent);font-size:2.4rem;text-shadow:0 0 20px var(--accent)}
.robot{position:absolute;top:42%;transform:translateY(-50%)}.entrance{left:18%}.far{right:18%}.corridor i{position:absolute;right:.5rem;top:.4rem;color:#37d67a;font-size:.55rem;font-style:normal}
.goal b{position:absolute;bottom:.7rem;color:#37d67a;font-size:.6rem;letter-spacing:.1em}.failure-flash{position:absolute;inset:0;display:grid;place-items:center;background:rgba(255,50,70,.2);color:#ff6b6b;font-size:7rem;font-weight:900;animation:pulse .6s infinite alternate}
@keyframes pulse{to{background:rgba(255,50,70,.42);transform:scale(.98)}}
.trace-info{display:flex;flex-direction:column;min-width:0}.trace-title{font-size:.72rem;color:#91a2bd;letter-spacing:.06em}.event-owner{text-transform:uppercase;color:var(--accent);font-size:.62rem;letter-spacing:.15em;margin-top:2rem}.event-name{font-family:monospace;font-size:1.55rem;font-weight:800;margin-top:.4rem;white-space:nowrap}.event-note{color:#a8b7cc;line-height:1.35;margin-top:.8rem;min-height:3rem}
.progress{height:4px;background:#28384f;margin-top:auto}.progress span{display:block;height:100%;background:var(--accent);transition:width .25s}.controls{display:flex;align-items:center;gap:.5rem;margin-top:.8rem}.controls button,.controls select{background:#17263c;color:#edf5ff;border:1px solid #3a4d68;padding:.35rem .65rem}.controls em{margin-left:auto;color:#71839e;font-size:.7rem}
</style>
