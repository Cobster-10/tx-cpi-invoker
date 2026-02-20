1. surfpool start (This is how you start the surfnet a local solana blockchain on your computer)
    - cd into anchor folder
    - run surfpool start

2. because you started it in the anchor folder it will automatically create a /runbooks/deployment folder and within this it has multiple different .tx files. These are files that have surfpools version of IaC infrastructure as code to deploy your anchor program. 

3. Surfpool will automatically deploy the anchor program, however sometimes it may fail 

4. If it fails 
    - cd into anchor folder
    - run surfpool run deployment -u --env localnet
    - you will get some output with an error or success 
        * often times there is an error with the programID not being synced 
        * otherwise use ai to fix the error until you sucessfully deploy the program

5. Finally run solana program show <PROGRAMID> --url http://127.0.0.1:8899 to confirm the deployment was successful

6. Then cd into anchor and run npm run test. This will execute the .ts test file in the /tests folder And you should be able to interact with your program
