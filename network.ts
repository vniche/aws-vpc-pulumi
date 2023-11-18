import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { Subnet, SubnetType, NATOptions, CreateNetworkArgs, CreateNATArgs, CreateNATRouteTableArgs } from "./types";

export class Network extends pulumi.ComponentResource {
    /**
     * The VPC ID.
     */
    readonly vpcId: pulumi.Output<string>;

    /**
     * 
     * The network subnets.
     */
    readonly subnets: Subnet[];

    /**
     *  The name given to the Network resource.
     */
    private name: string;

    /**
     * Validates a network creation arguments.
     * 
     * @param args The arguments to use to populate resource's properties.
     */
    private validateNetworkArgs(args: CreateNetworkArgs) {
        const { nat, subnets } = args;

        switch (nat) {
            case undefined:
            case NATOptions.None:
                break;
            case NATOptions.InOneAZ:
            case NATOptions.OnePerAZ:
                if (!subnets.some(({ type }) => type === SubnetType.Public)) throw new Error("At least one public and one private subnet are required for NAT Gateway usage");
                break;
            default:
                throw new Error(`NAT config ${nat} not supported`);
        }
    }

    /**
     * Create a NAT Gateway resource with the given arguments, and options.
     * 
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     * @returns the created NAT Gateway Pulumi resource
     */
    private createNATGateway(args: CreateNATArgs, opts?: pulumi.CustomResourceOptions): aws.ec2.NatGateway {
        const { subnetId, az, tags } = args;
        const eip = new aws.ec2.Eip(`${this.name}-eip-${az}`, {});

        return new aws.ec2.NatGateway(`${this.name}-nat-gateway-${az}`, {
            allocationId: eip.id,
            subnetId,
            tags
        }, opts);
    }

    /**
     * Create a NAT Gateway associated route table resource with the given arguments, and options.
     * 
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    private createNATRouteTable(args: CreateNATRouteTableArgs, opts?: pulumi.CustomResourceOptions) {
        const { vpcId, az, natGatewayId, subnetId } = args;
        const routeTable = new aws.ec2.RouteTable(`${this.name}-route-table-${az}`, {
            vpcId,
        }, opts);

        new aws.ec2.Route(`private-route-${az}`, {
            routeTableId: routeTable.id,
            destinationCidrBlock: "0.0.0.0/0",
            natGatewayId
        }, opts);

        new aws.ec2.RouteTableAssociation(`private-route-table-association-${az}`, {
            subnetId,
            routeTableId: routeTable.id,
        }, opts);
    }

    /**
     * Create a Network resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args: CreateNetworkArgs, opts?: pulumi.CustomResourceOptions) {
        super("AWSNetwork", name);
        this.name = name;
        this.validateNetworkArgs(args);

        const { nat, subnets: subnetsConfigs, tags } = args;
        if (subnetsConfigs.length == 0) {
            throw new Error("No subnets configs provided")
        }

        const vpc = new aws.ec2.Vpc(`${name}- vpc`, {
            cidrBlock: args.cidrBlock,
            tags
        }, {
            ...opts,
            parent: this
        });


        let internetGateway: aws.ec2.InternetGateway | undefined = undefined;

        const subnets: Subnet[] = [];
        for (let index in subnetsConfigs) {
            const { az, cidrBlock, type } = subnetsConfigs[index];

            const subnet = new aws.ec2.Subnet(`${name}-${type}-subnet-${az}`, {
                vpcId: vpc.id,
                cidrBlock: cidrBlock,
                availabilityZone: az,
                mapPublicIpOnLaunch: (type === SubnetType.Public),
                tags
            }, {
                parent: this
            });

            switch (type) {
                case SubnetType.Public:
                    if (!internetGateway) {
                        internetGateway = new aws.ec2.InternetGateway(`${name}-internet-gateway`, {
                            vpcId: vpc.id
                        }, {
                            parent: this
                        });
                    }

                    const routeTable = vpc.id.apply((id) => aws.ec2.getRouteTable({
                        filters: [
                            {
                                name: "vpc-id",
                                values: [id],
                            },
                            {
                                name: "association.main",
                                values: ["true"],
                            }
                        ]
                    }));

                    new aws.ec2.Route(`${name}-${type}-route-${az}`, {
                        routeTableId: routeTable.id,
                        destinationCidrBlock: "0.0.0.0/0",
                        gatewayId: internetGateway.id
                    }, {
                        parent: this
                    });

                    new aws.ec2.RouteTableAssociation(`${name}-${type}-route-table-association-${az}`, {
                        subnetId: subnet.id,
                        routeTableId: routeTable.id
                    }, {
                        parent: this
                    });
                    break;
                case SubnetType.Private:
                    break
                default:
                    throw new Error(`Subnet type ${type} not supported`)
            }

            subnets.push({
                ...subnetsConfigs[index],
                resource: subnet
            });
        }

        switch (nat) {
            case undefined:
            case NATOptions.None:
                break;
            case NATOptions.OnePerAZ:
                const found = subnets.find(({ type }) => type === SubnetType.Public);
                if (!found) throw new Error("No public subnets found to support NAT Gateway configuration");

                const natGateways: aws.ec2.NatGateway[] = [];

                const publicSubnets = subnets.filter(({ type }) => type === SubnetType.Public)
                publicSubnets.forEach((current) => {
                    natGateways.push(this.createNATGateway({
                        subnetId: current.resource.id,
                        az: current.az,
                        tags
                    }, {
                        parent: this
                    }));
                });

                const privateSubnets = subnets.filter(({ type }) => type === SubnetType.Private)
                privateSubnets.forEach((current) => {
                    natGateways.forEach((natGateway) => {
                        this.createNATRouteTable({
                            vpcId: vpc.id,
                            subnetId: current.resource.id,
                            az: current.az,
                            natGatewayId: natGateway.id
                        }, {
                            parent: this
                        });
                    })
                });
                break;
            case NATOptions.InOneAZ:
                const subnet = subnets.find(({ type }) => type === SubnetType.Public);
                if (!subnet) throw new Error("No public subnets found to support NAT Gateway configuration");

                const natGateway = this.createNATGateway({
                    subnetId: subnet.resource.id,
                    az: subnet.az,
                    tags
                }, {
                    parent: this
                });

                subnets.filter(({ type }) => type === SubnetType.Private).forEach((current) => {
                    this.createNATRouteTable({
                        vpcId: vpc.id,
                        subnetId: current.resource.id,
                        az: current.az,
                        natGatewayId: natGateway.id
                    }, {
                        parent: this
                    });
                });
                break;
            default:
                throw new Error(`NAT config ${nat} not supported`);
        }

        this.subnets = subnets
        this.vpcId = vpc.id
    }
}