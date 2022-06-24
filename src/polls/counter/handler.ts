import { DynamoDBStreamHandler } from 'aws-lambda'
import { DynamoDB } from 'aws-sdk'
import { AttributeMap } from 'aws-sdk/clients/dynamodb'
import { resolveTableName } from '../resolveTableName'
import { PollingTable, Vote } from '../../poller'
import { VoteCounter } from '../VoteCounter'

const ddb = new DynamoDB.DocumentClient()
const counter = new VoteCounter(ddb, resolveTableName(PollingTable.Counts) as string)

export const handler: DynamoDBStreamHandler = async event => {
  const votes = event.Records
    .filter(r => r.eventName === 'INSERT' || r.eventName === 'MODIFY')
    .map(r => ({
      next: r.dynamodb?.NewImage,
      prev: r.dynamodb?.OldImage
    }))
    .map(v => {
      const next = DynamoDB.Converter.unmarshall(v.next as AttributeMap) as Vote
      const prev = DynamoDB.Converter.unmarshall(v.prev as AttributeMap) as Vote
      return {
        ...next,
        prevChoice: prev.choice
      }
    })
  await counter.count(votes)
}
