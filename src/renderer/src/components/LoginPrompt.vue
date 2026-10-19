<script setup>
// 没登录的人按了要登录才能用的功能：「登录后才能听歌」→ 去登录 / 先看看
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const dialog = ref(null);

watch(
  () => auth.loginPrompt,
  action => {
    if (action) nextTick(() => dialog.value?.showModal());
    else dialog.value?.close();
  }
);

/** 登录了但还没兑换邀请码 */
const needInvite = computed(() => auth.loggedIn && auth.member === false);

function close() {
  auth.loginPrompt = '';
}
function goLogin() {
  close();
  router.push({
    name: 'login',
    query: route.fullPath === '/' ? {} : { redirect: route.fullPath },
  });
}
</script>

<template>
  <dialog ref="dialog" class="login-prompt" @close="close" @click.self="close">
    <div class="box">
      <h2 class="display">{{ needInvite ? '输入邀请码' : '登录' }}后才能{{ auth.loginPrompt }}</h2>
      <p>
        LyriStage 目前只开放给受邀的朋友。<template v-if="needInvite">输入朋友给你的邀请码就能开始使用。</template>
        <template v-else>没登录可以先随便看看，听歌、收藏和建歌单要登录。</template>
      </p>
      <div class="buttons">
        <button class="ghost" @click="close">先看看</button>
        <button class="primary" @click="goLogin">{{ needInvite ? '输入邀请码' : '去登录' }}</button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.login-prompt {
  width: min(400px, calc(100vw - 32px));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.35);
}
.login-prompt::backdrop {
  background: rgb(0 0 0 / 0.45);
}
.box {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
}
h2 {
  margin: 0;
  font-size: 24px;
  line-height: 1.3;
}
p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-dim);
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
button {
  padding: 10px 20px;
  border-radius: 999px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.primary {
  border: 0;
  background: var(--accent);
  color: var(--on-accent);
}
.ghost {
  border: 1px solid var(--line-strong);
  background: none;
  color: var(--text);
}
</style>
