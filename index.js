require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIP_SECRET);

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Parse JSON request bodies

// Firebase admin

const serviceAccount = require("./firebase-admin-key.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qkncn1b.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const database = client.db("pro_fast_db");

        const usersCollection = database.collection('users')
        const parcelsCollection = database.collection('parcels');
        const paymentHistoryCollection = database.collection("paymentHistory");
        const ridersCollection = database.collection("riders");

        // custom Middleware
        const verifyFBToken = async (req, res, next) => {
            const authHeader = req.headers?.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer')) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: 'unauthorized access' })
            }

            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            }
            catch (error) {
                return res.status(403).send({ message: 'forbidden access' });
            }
        };

        const verifyEmail = (req, res, next) => {
            if (!req.decoded.email === req.query.userEmail) {
                return res.status(403).send({ message: 'forbidden access' });
            } else {
                next();
            }
        };

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email };
            const user = await usersCollection.findOne(query);
            console.log(user)
            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        app.get("/users/search", verifyFBToken, verifyAdmin, async (req, res) => {
            const emailQuery = req.query.email;
            if (!emailQuery) {
                return res.status(400).send({ message: "Missing email query" });
            }

            const regex = new RegExp(emailQuery, "i"); // case-insensitive partial match
            try {
                const users = await usersCollection
                    .find({ email: { $regex: regex } })
                    // .project({ email: 1, createdAt: 1, role: 1 })
                    .limit(10)
                    .toArray();
                res.send(users);
            } catch (error) {
                console.error("Error searching users", error);
                res.status(500).send({ message: "Error searching users" });
            }
        });

        // GET API: Get user role by email
        app.post('/users/role', verifyFBToken, async (req, res) => {
            try {
                if (!usersCollection) {
                    return res.status(503).json({ message: "Database not connected or 'usersCollection' not initialized yet." });
                }

                const userEmail = req.body.email; // Get email from query parameters
                // Input validation: Ensure email is provided
                if (!userEmail) {
                    return res.status(400).json({ message: "Email query parameter is required." });
                }

                // Find the user by email
                // .project({ role: 1, _id: 0 }) ensures only the 'role' field is returned, and '_id' is excluded
                const user = await usersCollection.findOne(
                    { email: userEmail },
                    // { projection: { role: 1, _id: 0 } } // Project only the 'role' field, exclude '_id'
                );

                // Check if user was found
                if (!user) {
                    return res.status(404).json({ message: "User not found with the provided email." });
                }

                // Return the user's role
                res.status(200).json(user); // 'user' object will now contain just { role: "admin" } or { role: "user" }

            } catch (error) {
                console.error("Error retrieving user role:", error);
                res.status(500).json({ message: "Failed to retrieve user role.", error: error.message });
            }
        });

        app.post('/users', async (req, res) => {
            const email = req.body.email;

            const isUserExists = await usersCollection.findOne({ email });

            if (isUserExists) {
                return res.status(200).send({ message: "User already exists", insertedId: false })
            };
            const user = req.body;

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            try {

                const userId = req.params.id;
                const { role } = req.body; // Get the 'status' from the request body
                // console.log(riderId, status)
                // Validate the new status

                const objectId = new ObjectId(userId);

                // Update the rider's status
                const updateResult = await usersCollection.updateOne(
                    { _id: objectId }, // Filter by user ID
                    {
                        $set: {
                            role: role,
                            updated_at: new Date() // Update the timestamp
                        }
                    },
                );
                res.send(updateResult);

            } catch (error) {
                console.error("Error updating rider status:", error);
                res.status(500).json({ message: "Failed to update rider status.", error: error.message });
            }
        })

        // Rider related API
        app.get('/riders', async (req, res) => {
            try {
                const { status, wire_house } = req.query
                const query = {}
                if (status) {
                    query.status = status;
                }
                if (wire_house) {
                    query.wire_house = wire_house;
                }
                const result = await ridersCollection.find(query).toArray();
                res.send(result);
            } catch (err) {
                console.error("Error retrieving parcels:", err);
                res.status(500).json({ message: "Failed to retrieve parcels.", error: err.message });
            }
        });

        app.post('/riders', async (req, res) => {
            try {
                const data = req.body;
                const result = await ridersCollection.insertOne(data);
                res.send(result);
            } catch (err) {
                console.error("Error retrieving parcels:", err);
                res.status(500).json({ message: "Failed to retrieve parcels.", error: err.message });
            }
        });

        // PATCH API: Update rider status
        app.patch('/riders/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            try {

                const riderId = req.params.id;
                const { status, email } = req.body; // Get the 'status' from the request body
                // console.log(riderId, status)
                // Validate the new status
                const allowedStatuses = ['available', 'on_delivery', 'offline', 'unavailable'];

                const objectId = new ObjectId(riderId);

                // Update the rider's status
                const updateResult = await ridersCollection.updateOne(
                    { _id: objectId }, // Filter by rider ID
                    {
                        $set: {
                            status: status,
                            updated_at: new Date() // Update the timestamp
                        }
                    },
                );
                if (status === 'active' && updateResult.modifiedCount) {
                    const updateUser = await usersCollection.updateOne(
                        { email },
                        {
                            $set: {
                                role: 'rider',
                                updated_at: new Date().toISOString(),
                            }
                        },
                        { upsert: true }
                    )
                }
                res.send(updateResult);

            } catch (error) {
                console.error("Error updating rider status:", error);
                res.status(500).json({ message: "Failed to update rider status.", error: error.message });
            }
        });


        // GET API: Retrieve parcels, with optional user email query and latest first
        app.get('/parcels', verifyFBToken, async (req, res) => {
            try {
                // console.log(req.decoded)
                if (!parcelsCollection) {
                    return res.status(503).json({ message: "Database not connected or 'parcelCollections' not initialized yet." });
                }

                const userEmail = req.query?.userEmail;
                const parcelId = req.query?.parcelId;
                let query = {}; // Initialize an empty query object

                // If userEmail is provided, add it to the query filter
                if (userEmail) {
                    query.created_by = userEmail;
                }
                if (parcelId) {
                    query._id = new ObjectId(parcelId);
                }

                // Find documents based on the constructed query
                // Sort by 'createdAt' field in descending order (-1 for latest first)
                const parcels = await parcelsCollection.find(query).sort({ createdAt: -1 }).toArray();

                res.status(200).json(parcels);

            } catch (error) {
                console.error("Error retrieving parcels:", error);
                res.status(500).json({ message: "Failed to retrieve parcels.", error: error.message });
            }
        });

        // --- NEW API ENDPOINT: Get Paid and Not Collected Parcels ---
        app.get('/parcels/byStatus', async (req, res) => {
            try {
                if (!parcelsCollection) {
                    return res.status(503).json({ message: "Database not connected or 'parcelCollections' not initialized yet." });
                }
                const { payment_status, delivery_status } = req.query;

                let query = {}

                if (payment_status) {
                    query.payment_status = payment_status;
                };

                if (delivery_status) {
                    query.delivery_status = delivery_status;
                }

                // Find documents matching both conditions, sorted by creation date (latest first)
                const parcels = await parcelsCollection.find(query).sort({ payment_time: -1 }).toArray();

                res.status(200).json(parcels);

            } catch (error) {
                console.error("Error retrieving paid and not collected parcels:", error);
                res.status(500).json({ message: "Failed to retrieve parcels.", error: error.message });
            }
        });

        app.get('/parcels/rider/:riderId/assigned', async (req, res) => {
            try {
                if (!parcelsCollection) {
                    return res.status(503).json({ message: "Database not connected or 'parcelsCollection' not initialized yet." });
                }
                const riderId = req.params.riderId;
                const queryForUser = { _id: new ObjectId(riderId) };
                const user = await usersCollection.findOne(queryForUser);
                console.log(riderId)

                // Construct the query
                const query = {
                    assign_rider_email: user.email,
                    delivery_status: { $in: ['rider_assign', 'in_transit'] } // Match either status
                };

                // Find parcels matching the query, sorted by creation date (latest first)
                const parcels = await parcelsCollection.find(query).sort({ createdAt: -1 }).toArray();

                // If no parcels are found, return 404
                if (parcels.length === 0) {
                    return res.status(404).json({ message: "No parcels found for this rider with 'rider_assign' or 'in_transit' status." });
                }

                res.status(200).json(parcels);

            } catch (error) {
                console.error("Error retrieving assigned parcels for rider:", error);
                res.status(500).json({ message: "Failed to retrieve assigned parcels.", error: error.message });
            }
        });

        app.post('/parcels', async (req, res) => {
            try {
                const newParcel = req.body;
                // console.log(newParcel);
                const result = await parcelsCollection.insertOne(newParcel);
                res.send(result);
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Failed to create parcel' })
            }
        });

        // PATCH API: Update parcel payment_status to 'paid' and add payment_time
        app.patch('/parcels', async (req, res) => {
            try {
                const {
                    parcelId,
                    email,
                    amount,
                    transactionId,
                    paymentMethod,
                } = req.body
                console.log(parcelId)
                // Validate if the provided ID is a valid MongoDB ObjectId format
                if (!ObjectId.isValid(parcelId)) {
                    return res.status(400).json({ message: "Invalid Parcel ID format." });
                }

                const objectId = new ObjectId(parcelId);
                const paymentTime = new Date(); // Get current time for payment

                // Find the parcel first to get details for payment history
                const existingParcel = await parcelsCollection.findOne({ _id: objectId });

                if (!existingParcel) {
                    return res.status(404).json({ message: "Parcel not found with the provided ID." });
                }

                // Prevent multiple payments for the same parcel unless specifically allowed
                if (existingParcel.payment_status === 'paid') {
                    return res.status(400).json({ message: "Parcel is already marked as paid." });
                }

                // Update the parcel's payment status and add payment_time
                const updateResult = await parcelsCollection.findOneAndUpdate(
                    { _id: objectId },
                    {
                        $set: {
                            payment_status: 'paid',
                            payment_time: paymentTime,
                        }
                    },
                    { returnDocument: 'after' } // Return the updated document
                );
                // Ensure update was successful value
                if (!updateResult.payment_status === 'paid') {
                    console.log("Failed to update parcel payment status.")
                    return res.status(500).json({ message: "Failed to update parcel payment status." });
                }

                // Record payment in paymentHistory collection
                const paymentRecord = {
                    parcel_id: parcelId,
                    user_email: email,
                    amount,
                    payment_time: new Date(),
                    payment_time_strung: new Date().toISOString(),
                    transactionId,
                    paymentMethod,
                };

                const paymentResult = await paymentHistoryCollection.insertOne(paymentRecord);

                res.status(200).json({
                    message: "Parcel payment status updated to 'paid' and payment history recorded.",
                    insertedId: paymentResult.insertedId,
                });

            } catch (error) {
                console.error("Error updating parcel payment status:", error);
                res.status(500).json({ message: "Failed to update parcel payment status.", error: error.message });
            }
        });

        app.patch('/parcel/:id/rider', async (req, res) => {
            try {
                const parcelId = new ObjectId(req.params.id);
                const delivery_status = req.body?.delivery_status;
                const result = await parcelsCollection.updateOne(
                    { _id: parcelId },
                    {
                        $set: {
                            delivery_status,
                            updated_at: new Date().toISOString(),
                        }
                    }
                )
                res.send(result);

            } catch (error) {
                console.error("Error updating parcel payment status:", error);
                res.status(500).json({ message: "Failed to update parcel payment status.", error: error.message });
            }
        });

        // app.patch('/parcels/:id/rider', async (req, res) => {
        //     try {
        //         if (!parcelsCollection) {
        //             return res.status(503).json({ message: "Database not connected or 'parcelsCollection' not initialized yet." });
        //         }

        //         const parcelId = req.params.id;
        //         // Destructure the body to get delivery_status, and optionally assigned_rider_id/name
        //         const { delivery_status, assigned_rider_id, assigned_rider_name } = req.body;

        //         // 2. Prepare Update Fields
        //         let updateFields = {
        //             updatedAt: new Date() // Always update the timestamp
        //         };

        //         // Add rider assignment fields if provided
        //         // This makes the endpoint more versatile for "assigning a rider" and "updating status"
        //         if (assigned_rider_id) {
        //             // Optional: Validate if assigned_rider_id is a valid ObjectId if you store it as ObjectId in DB
        //             // if (!ObjectId.isValid(assigned_rider_id)) {
        //             //     return res.status(400).json({ message: "Invalid assigned_rider_id format." });
        //             // }
        //             updateFields.assigned_rider_id = assigned_rider_id;
        //         }
        //         if (assigned_rider_name) {
        //             updateFields.assigned_rider_name = assigned_rider_name;
        //         }

        //         // Ensure at least one update field is present besides updatedAt
        //         if (Object.keys(updateFields).length === 1 && updateFields.updatedAt) {
        //             return res.status(400).json({ message: "No valid fields to update. Please provide 'delivery_status', 'assigned_rider_id', or 'assigned_rider_name'." });
        //         }

        //         const objectId = new ObjectId(parcelId);

        //         // 3. Perform Update
        //         const updateResult = await parcelsCollection.findOneAndUpdate(
        //             { _id: objectId },
        //             { $set: updateFields },
        //             { returnDocument: 'after' } // Returns the modified document
        //         );

        //         // 5. Send Success Response
        //         res.status(200).json({
        //             message: "Parcel updated successfully!",
        //             parcel: updateResult.value // Return the updated parcel document
        //         });

        //     } catch (error) {
        //         console.error("Error updating parcel:", error);
        //         res.status(500).json({ message: "Failed to update parcel.", error: error.message });
        //     }
        // });

        app.patch('/parcels/:parcelId/assign', async (req, res) => {
            try {
                if (!parcelsCollection) {
                    return res.status(503).json({ message: "Database not connected or 'parcelCollections' not initialized yet." });
                }
                const parcelId = req.params.parcelId;
                const { delivery_status, assigned_rider_id, assigned_rider_name } = req.body;

                //update parcel
                const updateParcel = await parcelsCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            delivery_status,
                            assigned_rider_id,
                            assigned_rider_name,
                        }
                    },
                );
                const updateRider = await ridersCollection.updateOne(
                    { _id: new ObjectId(assigned_rider_id) },
                    {
                        $set: {
                            work_status: 'in_delivery',
                        }
                    }
                );


                res.send({ updateParcel, updateRider });

            } catch (error) {
                console.error("Error retrieving paid and not collected parcels:", error);
                res.status(500).json({ message: "Failed to retrieve parcels.", error: error.message });
            }
        })

        app.delete('/parcels/:id', async (req, res) => {
            try {

                const id = req.params.id;

                // Convert the string ID to a MongoDB ObjectId
                const query = { _id: new ObjectId(id) };

                // Delete the document from the 'parcelsCollection' collection
                const result = await parcelsCollection.deleteOne(query);
                res.send(result);

            } catch (error) {
                console.error("Error deleting parcel:", error);
                res.status(500).json({ message: "Failed to delete parcel.", error: error.message });
            }
        });

        // GET API: Retrieve payment history, with optional user email query and latest first
        app.get('/payments', verifyFBToken, async (req, res) => {
            try {
                if (!paymentHistoryCollection) {
                    return res.status(503).json({ message: "Database not connected or 'paymentHistoryCollection' not initialized yet." });
                }

                const userEmail = req.query.userEmail; // Get userEmail from query parameters
                let query = {}; // Initialize an empty query object

                // If userEmail is provided, filter by it
                if (userEmail) {
                    query.user_email = userEmail;
                }

                // Find documents based on the constructed query
                // Sort by 'payment_time' or 'recordedAt' in descending order (-1 for latest first)
                const history = await paymentHistoryCollection.find(query).sort({ payment_time: -1 }).toArray();

                res.status(200).json(history);

            } catch (error) {
                console.error("Error retrieving payment history:", error);
                res.status(500).json({ message: "Failed to retrieve payment history.", error: error.message });
            }
        });

        app.post("/create-checkout-session", async (req, res) => {
            const amountInCents = req.body?.amountInCents;
            console.log(amountInCents)
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents, // Amount in cents
                    currency: 'usd',
                    payment_method_types: ['card'],
                });

                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }

        });


        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send('Welcome to the Parcel Service API!');
});




// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});