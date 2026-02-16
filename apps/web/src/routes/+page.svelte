<script lang="ts">
  import {
    Connection,
    PublicKey,
    Transaction,
    clusterApiUrl,
    LAMPORTS_PER_SOL
  } from '@solana/web3.js';
  import {
    fetchOpenOrders,
    notifyCreateOrderSubmitted,
    requestCreateOrderTransaction,
    type OpenOrder
  } from '$lib/api';
  import { RPC_URL } from '$lib/config';

  let walletAddress = '';
  let connectError = '';
  let busy = false;
  let createError = '';
  let createMessage = '';
  let openOrders: OpenOrder[] = [];
  let loadError = '';

  let recipient = '';
  let amountSol = '0.01';
  let executionBountySol = '0.001';
  let triggerSlot = '';
  let expiresSlot = '';

  const connection = new Connection(RPC_URL || clusterApiUrl('devnet'), 'confirmed');

  function toLamports(sol: string): bigint {
    const parsed = Number(sol);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Invalid SOL amount');
    return BigInt(Math.floor(parsed * LAMPORTS_PER_SOL));
  }

  async function connectWallet(): Promise<void> {
    connectError = '';
    const provider = window.solana;
    if (!provider) {
      connectError = 'No injected wallet found. Install Phantom or another wallet-standard extension.';
      return;
    }

    try {
      await provider.connect();
      walletAddress = provider.publicKey?.toBase58() || '';
      await refreshOpenOrders();
    } catch (err) {
      connectError = err instanceof Error ? err.message : 'Wallet connection failed';
    }
  }

  async function disconnectWallet(): Promise<void> {
    const provider = window.solana;
    if (!provider) return;
    await provider.disconnect();
    walletAddress = '';
    openOrders = [];
  }

  async function refreshOpenOrders(): Promise<void> {
    loadError = '';
    try {
      openOrders = await fetchOpenOrders(walletAddress || undefined);
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to load open orders';
    }
  }

  async function createOrder(): Promise<void> {
    if (!walletAddress) {
      createError = 'Connect wallet first.';
      return;
    }

    createError = '';
    createMessage = '';
    busy = true;

    try {
      const trigger = triggerSlot.trim() || String(await connection.getSlot());
      const unsigned = await requestCreateOrderTransaction({
        user: walletAddress,
        recipient,
        transferLamports: toLamports(amountSol).toString(),
        executionBountyLamports: toLamports(executionBountySol).toString(),
        triggerSlot: trigger,
        expiresSlot: expiresSlot.trim() || undefined
      });

      const provider = window.solana;
      if (!provider) throw new Error('Wallet not available');

      const tx = Transaction.from(Buffer.from(unsigned.unsignedTransactionBase64, 'base64'));
      const signed = await provider.signTransaction(tx);
      const signature = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(signature, 'confirmed');

      await notifyCreateOrderSubmitted(signature);
      createMessage = `Order transaction sent: ${signature}`;
      await refreshOpenOrders();
    } catch (err) {
      createError = err instanceof Error ? err.message : 'Create order failed';
    } finally {
      busy = false;
    }
  }
</script>

<main>
  <div class="grid" style="gap: 20px;">
    <div class="card">
      <div class="row">
        <div>
          <h1>Order Executor</h1>
          <p>Create trigger-based orders and view open queue entries.</p>
        </div>
        <div class="actions">
          {#if walletAddress}
            <button on:click={disconnectWallet}>Disconnect</button>
          {:else}
            <button class="primary" on:click={connectWallet}>Connect Wallet</button>
          {/if}
        </div>
      </div>

      {#if walletAddress}
        <div class="code">Wallet: {walletAddress}</div>
      {/if}

      {#if connectError}
        <p class="error">{connectError}</p>
      {/if}
    </div>

    <div class="grid grid-2">
      <section class="card">
        <h2>Create Order</h2>
        <p>This form asks your backend to build an unsigned create-order transaction.</p>

        <label>
          Recipient Pubkey
          <input bind:value={recipient} placeholder="Recipient wallet" />
        </label>

        <label>
          Transfer Amount (SOL)
          <input bind:value={amountSol} placeholder="0.01" />
        </label>

        <label>
          Execution Bounty (SOL)
          <input bind:value={executionBountySol} placeholder="0.001" />
        </label>

        <label>
          Trigger Slot (optional)
          <input bind:value={triggerSlot} placeholder="Current slot if empty" />
        </label>

        <label>
          Expires Slot (optional)
          <input bind:value={expiresSlot} placeholder="No expiry if empty" />
        </label>

        <div class="actions">
          <button class="primary" disabled={busy || !walletAddress} on:click={createOrder}>
            {busy ? 'Submitting...' : 'Create Order'}
          </button>
        </div>

        {#if createMessage}
          <p>{createMessage}</p>
        {/if}
        {#if createError}
          <p class="error">{createError}</p>
        {/if}
      </section>

      <section class="card">
        <div class="row">
          <h2>Open Orders</h2>
          <button on:click={refreshOpenOrders}>Refresh</button>
        </div>

        {#if loadError}
          <p class="error">{loadError}</p>
        {/if}

        {#if openOrders.length === 0}
          <p>No open orders returned.</p>
        {:else}
          <div class="grid">
            {#each openOrders as order}
              <article class="card" style="padding: 12px; gap: 8px;">
                <div class="row">
                  <strong class="code">{order.orderPubkey}</strong>
                  <span class="badge">Order #{order.orderId}</span>
                </div>
                <p>User: <span class="code">{order.user}</span></p>
                <p>Status: executed={String(order.executed)} canceled={String(order.canceled)}</p>
              </article>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  </div>
</main>
