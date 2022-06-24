import DynamoDB from 'aws-sdk/clients/dynamodb'
import { chain } from 'lodash'
import { VoteKey, Vote, CountItem, CountKey } from '../poller'

/**
 * Responsible for transactionally counting new votes.
 *
 */
export class VoteCounter {
  constructor (private ddb: DynamoDB.DocumentClient, private tableName: string) {
  }

  groupByPollAndChoice (allVotes: Vote[]): Record<string, Record<number, number>> {
    const choiceKey: keyof Vote = 'choice'
    const prevChoiceKey: keyof Vote = 'prevChoice'
    const newValues = chain(allVotes)
      .groupBy(VoteKey.PollId)
      .mapValues(votes => chain(votes).countBy(choiceKey).value()).value()

    const prevValues = chain(allVotes)
      .groupBy(VoteKey.PollId)
      .mapValues(votes => chain(votes).countBy(prevChoiceKey).value()).value()

    for (const pollId of Object.keys(prevValues)) {
      for (const choice of Object.keys(prevValues[pollId])) {
        if (choice !== 'undefined') {
          newValues[pollId][choice] = -1 * prevValues[pollId][choice]
        }
      }
    }

    return newValues
  }

  toCountUpdates (voteCounts: Record<string, Record<number, number>>): CountItem[] {
    const countUpdates: CountItem[] = []
    for (const pollId of Object.keys(voteCounts)) {
      for (const choiceString of Object.keys(voteCounts[pollId])) {
        const choice = parseInt(choiceString)
        const count = voteCounts[pollId][choice]
        countUpdates.push({
          pollId,
          choice,
          count
        })
      }
    }
    return countUpdates
  }

  toDbUpdate (item: CountItem): DynamoDB.DocumentClient.Update {
    const countKey: keyof CountItem = 'count'
    const countExpression = `:${countKey}`
    const countNameExpression = `#${countKey}`
    return {
      TableName: this.tableName,
      Key: {
        [CountKey.Choice]: item.choice,
        [CountKey.PollId]: item.pollId
      },
      ExpressionAttributeValues: {
        [countExpression]: item.count
      },
      ExpressionAttributeNames: {
        [countNameExpression]: countKey
      },
      UpdateExpression: `add ${countNameExpression} ${countExpression}`
    }
  }

  /**
   * Count new votes. If the counting process fails for any single vote then the whole batch is rejected to prevent double-counting
   * @param votes
   */
  async count (votes: Vote[]): Promise<void> {
    const voteCounts = this.groupByPollAndChoice(votes)
    const countUpdates = this.toCountUpdates(voteCounts)
    if (countUpdates.length) {
      await this.ddb.transactWrite(({
        TransactItems: countUpdates.map(u => ({
          Update: this.toDbUpdate(u)
        }))
      })).promise()
    }
  }
}
