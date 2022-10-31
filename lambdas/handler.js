const AWS = require('aws-sdk')
const { v4: uuidv4 } = require('uuid');

const ses = new AWS.SES({ region: 'eu-west-3' });
const documentClient = new AWS.DynamoDB.DocumentClient;
const sqs = new AWS.SQS({ region: 'eu-west-3' });

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

exports.createInquiry = async (event) => {
    const INQUIRY_TABLE_NAME = process.env.INQUIRY_TABLE_NAME;
    const INQUIRY_PROCESSING_QUEUE_URL = process.env.INQUIRY_PROCESSING_QUEUE_URL;

    const { body } = event;
    const { inquiryType, inquiries } = JSON.parse(body);
    // const id = new Date().getTime().toString();
    const id = uuidv4()

    const inquiry = {
        id,
        inquiryType,
        inquiryItems: inquiries
    };

    console.log('PARAMS::', inquiry);

    const putParams = {
        TableName: INQUIRY_TABLE_NAME,
        Item: inquiry
    }

    // save to db
    await documentClient.put(putParams).promise();

    console.log(`inquiry ${id} created`);

    // add the persisted inquiry in the queue which will notify the admin

    const { MessageId } = await sqs
        .sendMessage({
            QueueUrl: INQUIRY_PROCESSING_QUEUE_URL,
            MessageBody: JSON.stringify({ inquiry, admin: ADMIN_EMAIL }),
        })
        .promise();
    console.log(`Message ${MessageId} and ${ADMIN_EMAIL} sent to queue`);

    return {
        statusCode: 200,
        body: JSON.stringify({
            inquiry,
            messageId: MessageId
        })
    };
};

exports.processInquiry = async (event) => {
    const SOURCE_EMAIL = "graffincindy@gmail.com";

    console.log("CALLING Process::", event);

    const recordPromises = event.Records.map(async (record) => {
        const { body } = record;
        const { inquiry, admin } = JSON.parse(body);
        const { inquiryType, inquiryItems } = inquiry;
        console.log("ADMIN::", admin);

        const joinedItems = inquiryItems.join(", ");

        const inquiryMessage = `New inquiry received: ${inquiryType} Items: ${joinedItems}`;
        const sesParams = {
            Message: {
                Body: {
                    Text: {
                        Data: inquiryMessage,
                        Charset: "UTF-8",
                    },
                },
                Subject: {
                    Data: "New inquiry received",
                    Charset: "UTF-8",
                },
            },
            Source: SOURCE_EMAIL,
            Destination: {
                ToAddresses: [admin],
            },
        };
        await ses.sendEmail(sesParams).promise();
    });
    await Promise.all(recordPromises);
};