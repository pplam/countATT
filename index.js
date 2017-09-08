const fs = require('fs')
const BN = require('bignumber.js')
const rp = require('request-promise')
const abi = require('ethereumjs-abi')
const trans = require('./inputs/trans.json')

const toBlock = process.argv[2]

const opts = {
  uri: 'https://api.etherscan.io/api',
  qs: {
    module: 'logs',
    action: 'getLogs',
    fromBlock: '4244550',
    toBlock,
    address: '0x887834d3b8d450b6bab109c252df3da286d73ce4',
    topic2: '0x000000000000000000000000aee129da02f62711b404bb1e1aa97650a958b821',
    apikey: 'DTXTXHA7MVZNP4EJBR3IF2IRAFBAETYPJY',
  },
  json: true,
}

rp(opts).then(processData).catch(console.log)

function processData(rawData) {
  const refunds = rawData.result

  const uniqTrans = xUniqTxs(trans, xTran)
  const reducedTrans = reduceTxs(uniqTrans)
  const decodedTrans = flattenAccountsObj(reducedTrans)
  const tranCount = countAmounts(reducedTrans)

  const uniqRefunds = xUniqTxs(refunds, xRefund)
  const reducedRefunds = reduceTxs(uniqRefunds)
  const decodedRefunds = flattenAccountsObj(reducedRefunds)
  const refundCount = countAmounts(reducedRefunds)

  const {
    inCompares,
    inequals,
  } = compareAccounts(reducedTrans, reducedRefunds)

  const tranDecodedFile = './outputs/tran_decoded.csv'
  const tranCountFile = './outputs/tran_counts.json'
  const refundDecodedFile = './outputs/refund_decoded.csv'
  const refundCountFile = './outputs/refund_counts.json'
  const compareFile = './outputs/compared.csv'
  const inequalFile = './outputs/inequals.csv'

  fs.writeFileSync(tranDecodedFile, bulkObj2csv(decodedTrans, [
    'address',
    'eth',
    'att',
  ]))
  fs.writeFileSync(refundDecodedFile, bulkObj2csv(decodedRefunds, [
    'address',
    'att',
  ]))


  fs.writeFileSync(tranCountFile, JSON.stringify(tranCount))
  fs.writeFileSync(refundCountFile, JSON.stringify(refundCount))


  fs.writeFileSync(compareFile, bulkObj2csv(inCompares, [
    'address',
    'tranAtt',
    'refundAtt',
    'diff',
  ]))
  fs.writeFileSync(inequalFile, bulkObj2csv(inequals, [
    'address',
    'diff',
  ]))
}

function xTran(raw) {
  let address = '0x'
  address += raw.topics[1].slice(-40)

  const rawAmounts = abi.rawDecode([
    'uint256',
    'uint256'
  ], new Buffer(raw.data.slice(2), 'hex'))
  const primaryEth = rawAmounts[0].toString()
  const primaryAtt = rawAmounts[1].toString()
  const eth = new BN(primaryEth)
    .div(1e+18).toString()
  const att = new BN(primaryAtt)
    .div(1e+18).toString()

  return {
    address,
    eth,
    att,
  }
}

function xRefund(raw) {
  let address = '0x'
  address += raw.topics[1].slice(-40)

  const rawAmounts = abi.rawDecode([
    'uint256'
  ], new Buffer(raw.data.slice(2), 'hex'))

  const primaryAtt = rawAmounts[0].toString()
  const att = new BN(primaryAtt)
    .div(1e+18).toString()

  return {
    address,
    att,
  }
}

function xUniqTxs(txs, decoder) {
  const txsObj = txs.reduce((obj, tx) => {
    const txHash = tx.transactionHash
    const account = decoder(tx)
    obj[txHash] = account
    return obj
  }, {})

  return Object.values(txsObj)
}

function reduceTxs(txs) {
  const accountsObj = txs.reduce((ret, tx) => {
    const addr = tx.address
    const account = ret[addr]
    if (account) {
      if (tx.eth) {
        const accEth = account.eth || '0'
        account.eth = new BN(accEth)
          .plus(tx.eth).toString()
      }
      if (tx.att) {
        const accAtt = account.att || '0'
        account.att = new BN(accAtt)
          .plus(tx.att).toString()
      }
    } else {
      const vals = Object.assign({}, tx)
      ret[addr] = vals
    }
    return ret
  }, {})

  return accountsObj
}

function flattenAccountsObj(accountsObj) {
  return Object.entries(accountsObj)
    .map((entry) => {
      const address = entry[0]
      return Object.assign({
        address,
      }, entry[1])
    })
}

function countAmounts(accountsObj) {
  let totalEth = 0
  let totalAtt = 0

  Object.getOwnPropertyNames(accountsObj)
    .forEach((addr) => {
      const eth = accountsObj[addr].eth || 0
      const att = accountsObj[addr].att || 0

      totalEth = new BN(totalEth).plus(eth)
      totalAtt = new BN(totalAtt).plus(att)
    })

  return {
    totalEth,
    totalAtt,
  }
}

function compareAccounts(tranAccs, refundAccs) {
  const inequals = []
  const inCompares = []
  Object.getOwnPropertyNames(refundAccs)
    .forEach((refundAddr) => {
      const refundAtt = refundAccs[refundAddr].att
      const tranAtt = tranAccs[refundAddr].att
      const diff = new BN(tranAtt)
        .minus(refundAtt).toString()
      inCompares.push({
        address: refundAddr,
        tranAtt,
        refundAtt,
        diff,
      })
      if (diff !== '0') inequals.push({
        address: refundAddr,
        diff,
      })
    })
  return {
    inCompares,
    inequals,
  }
}

function bulkObj2csv(objs, fields) {
  const header = fields.join(',')
  const rows = [header]
  objs.forEach((obj) => {
    const row = fields
      .map(f => obj[f])
      .join(',')
    rows.push(row)
  })

  return rows.join('\n')
}
