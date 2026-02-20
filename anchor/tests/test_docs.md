1. Create Order test
    - Sends a transaction to initialize the order counter for a random user 
    - sends a transaction to create an order for a random user where he will have a cpi transaction to transfer 1 SOL to the default solana pubkey in my solana cli settings, after slot 0 has passed
    
2. Execute Order 
    - sends a transaction mimicing from the keeper. The tx executes the order made in the test 1. It checks that the order pda is in the right state and the cpi transfered sol to the other. 

3. Cancel Order 
    - sends a transaction from a ranom user that creates an order with a cpi tx to transfer 1 SOL to the default solana pubkey in my solana cli settings after slot 0 passed. 
    - sends a transaction from the random user to cancel the order and check that the order pda state has changed, and the user has been refunded. 