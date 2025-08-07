


## Transaction created event
The transaction created spend webhook is sent when a transaction is created, whether it has been authorized or declined. You must persist this information.
This event initiates the purchase lifecycle in case of `pending`, then could exist many intermediate state changes done by `transaction update` event and finally the  `transaction complete` event sets the purchase in terminal state. No more events coming except of a refund.

| field              | description   | example                                      |
|--------------------|--------|----------------------------------------------|
| id                 | webhookId and always the same when retry | 372d1a76-8a57-403e-a7f3-ac3231be144c         |
| timestamp          | Time when sent the event. Always the same when retry | 2025-08-06T20:29:23.870Z                     |
| resource           |  | transaction                                  |
| action             |  | created                                      |
| body.id            | Transaction id. Is the same for many events in the life cycle of the purchase | f1083e93-afd5-4271-85c6-dd47099e9746         |
| body.type          |  | spend                                        |
| body.spend.account | Address of the user | 0xa7d5e73027844145A538F4bfD7b8d9b41d8B89d3   |
| body.spend.amount  | Amount of the purchase in USD in cents. 1 USD = 100 | 100                                          |
| body.spend.currency| Always in usd | usd                                          |
| body.spend.cardId  |  | 47c3c3b3-b197-4a97-ace3-901a6ad7cf61         |
| body.spend.localAmount | Purchase amount in local currency | 100                                      |
| body.spend.localCurrency | The local currency | usd, eur, ars                                    |
| body.spend.merchantCity? | The merchant city | "San Francisco"                          |
| body.spend.merchantCountry? | The merchant country | "US"                                 |
| body.spend.merchantCategory? | The merchant category | "5814 - Quick Payment Service-Fast Food Restaurants"                               |
| body.spend.merchantName | The merchant name | SQ *BLUE BOTTLE COFFEE|
| body.spend.authorizedAt | Time when purchase was authorized in ISO 8601   | 2025-08-06T20:29:23.288Z                |
| body.spend.authorizedAmount | CHECK IF NECESSARY | 100                                 |
| body.spend.status  | Can be pending or declined. In case of declined, the field `declinedReason` has the reason | pending                                      |
| body.spend.declinedReason?  | decline message| webhook declined                                      |



## Transaction updated event






## Transaction completed event





## User updated

## Card updated
